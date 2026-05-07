# Agent Watch Protocol — OSC 9999

D-Terminal, terminalde çalışan AI tool'larının (Claude Code, Codex, aider, mods, vb.) **agent yaşam döngüsünü** ayrı bir sidebar'da görselleştirir. Tool'lar opt-in olarak özel bir OSC sequence yayar; D-Terminal bunu parse edip per-pane Agent Watch panelinde gösterir.

## Wire Format

```
ESC ] 9999 ; <event-json> BEL
```

`event-json` UTF-8 encoded compact JSON. Trailing newline yok.

### Örnek

```
\e]9999;{"k":"start","id":"a1","name":"Refactor types"}\a
\e]9999;{"k":"tokens","id":"a1","in":1240,"out":820}\a
\e]9999;{"k":"thinking","id":"a1","text":"Önce mevcut tipleri tarayayım..."}\a
\e]9999;{"k":"progress","id":"a1","msg":"Editing 3 files\n"}\a
\e]9999;{"k":"end","id":"a1","status":"ok"}\a
```

## Event Types

### `start`
Yeni agent kaydı. Aynı `id` ile gelirse mevcut state reset (re-run).

```json
{
  "k": "start",
  "id": "a1",
  "name": "Refactor types",
  "parent": "main"
}
```

| Alan | Tip | Açıklama |
|---|---|---|
| `id` | string | Agent'ın unique ID'si |
| `name` | string | Sidebar'da gösterilecek kısa açıklama |
| `parent` | string? | Parent agent id — subagent ise (sidebar'da hiyerarşi) |

### `progress`
Agent'ın stream'ine eklenecek metin parçası. Sidebar'ın output preview'unda biriktirilir (32KB rotate).

```json
{ "k": "progress", "id": "a1", "msg": "Reading file: src/foo.ts\n" }
```

### `tokens`
Cumulative token sayacı + cost. Mutlak değer (delta değil), her güncellemede tam state gönderilir.

```json
{ "k": "tokens", "id": "a1", "in": 1240, "out": 820, "cost": 0.012 }
```

### `thinking`
Reasoning bloğu. Sidebar'da accordion altında gizli, kullanıcı isterse açar. Birden fazla blok birikebilir (max 12, eski silinir).

```json
{ "k": "thinking", "id": "a1", "text": "Düşünme metni..." }
```

### `await`
Agent kullanıcı onayı bekliyor (örn. `Run this command? (y/n)`). UI durumu `⏸ waiting` olur, sarı pulse + title bar yanıp söner. Sonraki `progress` veya `end` event'inde otomatik clear olur.

```json
{ "k": "await", "id": "a1", "prompt": "Run npm install? (y/n)" }
```

| Alan | Tip | Açıklama |
|---|---|---|
| `prompt` | string? | Onay istenen işlem — sidebar'da satır altında gösterilir |

### `end`
Agent yaşam döngüsünün sonu.

```json
{ "k": "end", "id": "a1", "status": "ok" }
```

`status`: `"ok"` | `"error"` | `"aborted"`. `error` ise `"error"` field'ında hata mesajı.

## Tool authors için emit örneği

### Bash / Node script
```bash
emit() {
  printf '\e]9999;%s\a' "$1"
}

emit '{"k":"start","id":"a1","name":"Setup task"}'
# ... iş yap ...
emit '{"k":"tokens","id":"a1","in":500,"out":200}'
emit '{"k":"end","id":"a1","status":"ok"}'
```

### Python
```python
import json, sys
def emit(evt):
    sys.stdout.write(f"\x1b]9999;{json.dumps(evt, separators=(',',':'))}\x07")
    sys.stdout.flush()

emit({"k": "start", "id": "a1", "name": "Refactor"})
```

### TypeScript / Node
```ts
function emit(evt: object) {
  process.stdout.write(`\x1b]9999;${JSON.stringify(evt)}\x07`);
}

emit({ k: 'start', id: 'a1', name: 'Lint check' });
```

## Tool detection (önerilen)

D-Terminal kendisini `TERM_PROGRAM=D-Terminal` env değişkeni ile tanıtır (gelecek). Tool'lar bu env'i kontrol edip OSC yaymaya karar verebilir:

```ts
const isDTerminal = process.env.TERM_PROGRAM === 'D-Terminal';
if (isDTerminal) emit({ k: 'start', id, name });
```

## Pratik notlar

- **Bozuk JSON**: D-Terminal sessizce yutar, terminal output'una etkisi olmaz (OSC handler false döner, xterm normal akışa devam eder)
- **Boyut limiti**: tek event ~16KB üstüse parse edilmeyebilir (xterm parser limiti)
- **Eşzamanlı agent'lar**: birden fazla `start` farklı `id`'lerle paralel agent'ları temsil eder, sidebar hepsini ayrı satır olarak gösterir
- **Subagent hiyerarşisi**: `parent` alanı sidebar'da görsel olarak girinti gösterir (gelecek), şu an metinde "subagent of X" notu

## Future work

- **`dterm-watch` wrapper** — `claude-code`, `codex`, `aider` gibi araçları sarar, output'tan heuristic OSC üretir (opt-in olmasa bile çalışır)
- **MCP bridge** — D-Terminal'in MCP server'ı, Claude Code MCP client → standart notification protocol
- **Post-hoc split** — agent run bittikten sonra "Split agents into panes" sağ tık aksiyonu, her agent'ın output'unu ayrı read-only pane'de gösterir
- **Multi-agent realtime split-view** — eşzamanlı agent'lar sidebar yerine otomatik N-yönlü pane split (kullanıcı tercih ederse)

Tetik sinyalleri (yapılma kararı için):
- 50+ kullanıcı bu feature'ı düzenli kullanıyor
- En az 1 popüler AI tool D-Terminal'i resmi destekliyor
- Wrapper script yaygın kullanım kazanıyor
