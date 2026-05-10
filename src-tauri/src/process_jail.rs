// ProcessJail — D-Terminal'in spawn ettiği tüm child process'leri tek bir
// Windows Job Object altında topluyor. Faydalar:
//
//  1. **Console window suppression** (kullanıcı raporu): `Command::new(...)`
//     ile spawn edilen child'lar default olarak yeni bir conhost.exe açar
//     → ekranda kısa süreli "DOS penceresi" flash. `configure_command()`
//     `CREATE_NO_WINDOW` flag'ini ekler ve flash'ı engeller.
//
//  2. **Kill-on-close** (zombie process guard): Job Object
//     `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag'i ile yaratılır. D-Terminal
//     crash ederse veya abruptly kill edilirse Windows tüm job üyelerini
//     (sidecar, git_stat'ın spawn ettiği `git`, vs.) otomatik temizler.
//     Eskiden orphan kalmış sidecar process'leri 15s heartbeat timeout'a
//     kadar yaşıyordu; şimdi process tree garantili yutulur.
//
//  3. **Runtime toggle** (debug ergonomi): `set_suppress_consoles(false)`
//     ile child window'lar görünür yapılabilir — geliştirici external
//     console GUI tool spawn etmek isterse Settings'ten flip edebilir.
//
// Cross-platform: macOS/Linux'ta Job Object yok; orada tüm metodlar no-op.
// `cfg(windows)` guard'ları unsafe blokları sınırlandırır.

use parking_lot::Mutex;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Windows CREATE_NO_WINDOW process creation flag'i.
/// `windows` crate `Win32::System::Threading::CREATE_NO_WINDOW` ile aynı değer
/// — sabit olarak tutmak std::os::windows::process::CommandExt::creation_flags
/// imzası ile (`u32`) ile uyumlu.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows Job Object handle wrapper — Drop'ta CloseHandle çağırır.
/// Send + Sync impl edildi: Win32 HANDLE'lar process-wide unique ve
/// AssignProcessToJobObject thread-safe (MSDN).
#[cfg(windows)]
struct JobHandle {
    raw: windows::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.raw);
        }
    }
}

#[cfg(windows)]
unsafe impl Send for JobHandle {}
#[cfg(windows)]
unsafe impl Sync for JobHandle {}

pub struct ProcessJail {
    /// Console window suppression toggle. Atomic → lock-free reads from
    /// hot path (her spawn'da configure_command çağrılır).
    suppress: AtomicBool,

    /// Job Object handle. None ise (yaratım fail veya non-Windows platform)
    /// configure_command yine `CREATE_NO_WINDOW` ekler ama assign() no-op
    /// olur — graceful degradation.
    #[cfg(windows)]
    job: Mutex<Option<JobHandle>>,
}

impl ProcessJail {
    /// Yeni jail yaratır. Windows'ta Job Object oluşturulup
    /// KILL_ON_JOB_CLOSE flag'i set edilir. Yaratım fail olursa
    /// (extremely rare — Win32 quota exhaustion) jail yine kullanılabilir
    /// durumda kalır, sadece kill-on-close garantisi yoktur.
    pub fn new(suppress_consoles: bool) -> Arc<Self> {
        #[cfg(windows)]
        let job = Self::create_job_object();
        #[cfg(windows)]
        if job.is_none() {
            tracing::warn!("ProcessJail: Job Object creation failed; kill-on-close disabled");
        }
        Arc::new(Self {
            suppress: AtomicBool::new(suppress_consoles),
            #[cfg(windows)]
            job: Mutex::new(job),
        })
    }

    #[cfg(windows)]
    fn create_job_object() -> Option<JobHandle> {
        use windows::core::PCWSTR;
        use windows::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            // Anonymous job (no name) — process'e bağlı, başka bir process
            // duplicate handle ile ele geçiremez. PCWSTR::null = isimsiz.
            let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            if handle.is_invalid() {
                return None;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let info_size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
            let result = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                info_size,
            );
            if result.is_err() {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
                return None;
            }
            Some(JobHandle { raw: handle })
        }
    }

    /// Console suppression toggle. Settings UI bunu runtime'da flip eder.
    /// Mevcut child'ları etkilemez — sadece bu çağrıdan sonraki spawn'lara
    /// uygulanır (doğru davranış: runtime tracker stateful değil).
    pub fn set_suppress_consoles(&self, val: bool) {
        self.suppress.store(val, Ordering::Relaxed);
    }

    pub fn suppress_consoles(&self) -> bool {
        self.suppress.load(Ordering::Relaxed)
    }

    /// Bir Command'a console-window suppression flag'lerini uygular.
    /// Idempotent: aynı Command'a birden fazla çağrı güvenli (creation_flags
    /// `set` semantiği — değer overwrite olur, additive değil).
    /// Suppress kapalıysa no-op — komut normal şekilde çalışır.
    pub fn configure_command(&self, cmd: &mut Command) {
        if !self.suppress.load(Ordering::Relaxed) {
            return;
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        #[cfg(not(windows))]
        {
            // POSIX'te console window kavramı yok; no-op.
            let _ = cmd;
        }
    }

    /// Spawn edilmiş bir Child'ı job object'e atar. Job kapandığında (parent
    /// crash veya graceful drop) tüm üye process'ler KILL_ON_JOB_CLOSE ile
    /// terminate edilir. Job henüz kurulu değilse (yaratım fail) no-op
    /// döner — graceful degradation.
    ///
    /// Ok(false) → job kurulu değil, assign atlandı (warning durumu).
    /// Ok(true)  → başarılı assign.
    /// Err       → AssignProcessToJobObject hata kodu (rare; nested job
    ///             conflict veya child zaten exit).
    pub fn assign(&self, child: &Child) -> Result<bool, String> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::Foundation::HANDLE;
            use windows::Win32::System::JobObjects::AssignProcessToJobObject;

            let job_lock = self.job.lock();
            let Some(job_handle) = job_lock.as_ref() else {
                return Ok(false);
            };
            // child.as_raw_handle() → *mut c_void (HANDLE'ın inner type'ı).
            // windows-0.58 HANDLE tuple struct, raw pointer'ı direkt sarar.
            let child_handle = HANDLE(child.as_raw_handle());
            unsafe {
                AssignProcessToJobObject(job_handle.raw, child_handle)
                    .map_err(|e| format!("AssignProcessToJobObject: {e}"))?;
            }
            Ok(true)
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(false)
        }
    }

    /// Diagnostic: job kurulu mu (Windows + Job Object yaratıldı).
    /// Health check / log için.
    pub fn has_job(&self) -> bool {
        #[cfg(windows)]
        {
            self.job.lock().is_some()
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_default_suppresses_consoles() {
        let jail = ProcessJail::new(true);
        assert!(jail.suppress_consoles());
    }

    #[test]
    fn new_can_start_with_suppress_off() {
        let jail = ProcessJail::new(false);
        assert!(!jail.suppress_consoles());
    }

    #[test]
    fn set_suppress_runtime_toggle_works() {
        let jail = ProcessJail::new(true);
        jail.set_suppress_consoles(false);
        assert!(!jail.suppress_consoles());
        jail.set_suppress_consoles(true);
        assert!(jail.suppress_consoles());
    }

    #[test]
    fn configure_command_with_suppress_off_is_noop() {
        // Suppress kapalıysa Command flag'leri set edilmez — yine de panic
        // veya state bozulması olmaz. Smoke test.
        let jail = ProcessJail::new(false);
        let mut cmd = Command::new("nonexistent-binary-for-test");
        jail.configure_command(&mut cmd);
        // (Komut spawn edilmez — sadece flag uygulamasını kontrol ediyoruz.)
    }

    #[test]
    fn configure_command_idempotent() {
        // Aynı Command'a iki kez configure_command çağırmak zarar vermez.
        let jail = ProcessJail::new(true);
        let mut cmd = Command::new("nonexistent-binary-for-test");
        jail.configure_command(&mut cmd);
        jail.configure_command(&mut cmd);
    }

    #[test]
    fn arc_clone_shares_state() {
        // ProcessJail Arc<Self> döner — clone'lar aynı internal state'i
        // paylaşmalı ki frontend toggle'ı tüm spawn site'ları etkilesin.
        let jail = ProcessJail::new(true);
        let clone = jail.clone();
        clone.set_suppress_consoles(false);
        assert!(!jail.suppress_consoles());
        assert!(!clone.suppress_consoles());
    }

    #[cfg(windows)]
    #[test]
    fn windows_creates_job_object() {
        let jail = ProcessJail::new(true);
        assert!(
            jail.has_job(),
            "Windows'ta Job Object yaratılmalı (quota exhaustion DEĞİL)"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_spawn_assign_real_child_succeeds() {
        // cmd.exe /c exit 42 — anlık çıkış, console window flash olmaz
        // (configure_command CREATE_NO_WINDOW eklediği için).
        let jail = ProcessJail::new(true);
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/c", "exit 42"]);
        jail.configure_command(&mut cmd);
        let mut child = cmd.spawn().expect("cmd.exe spawn (test ortamı)");
        let assigned = jail.assign(&child).expect("assign sonucu");
        assert!(assigned, "Job kurulu olduğu halde assign false döndü");
        let status = child.wait().expect("child wait");
        assert_eq!(status.code(), Some(42));
    }

    #[cfg(windows)]
    #[test]
    fn windows_assign_after_child_exit_handles_gracefully() {
        // Race senaryosu: child assign çağrılmadan önce exit olabilir.
        // AssignProcessToJobObject buna karşı hata verebilir; biz Result
        // döndürüyoruz, panic etmiyoruz.
        let jail = ProcessJail::new(true);
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/c", "exit 0"]);
        jail.configure_command(&mut cmd);
        let mut child = cmd.spawn().expect("cmd.exe spawn");
        let _ = child.wait();
        // Child zaten exit etti; assign muhtemelen Err döner ama panic etmez.
        let result = jail.assign(&child);
        // Ok(true), Ok(false) veya Err — hepsi acceptable, panic yoksa OK.
        let _ = result;
    }
}
