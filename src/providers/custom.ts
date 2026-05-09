// Custom — kullanıcının kendi OpenAI-uyumlu endpoint'i.
//
// Kullanım senaryoları:
//   - OpenRouter (https://openrouter.ai/api/v1)
//   - Together AI, DeepInfra, Groq, Fireworks AI vb.
//   - Kendi self-hosted vLLM, TGI, Ollama proxy'si
//   - Kurumsal Azure OpenAI deployment
//
// Endpoint URL Settings'te girilir (`ui.aiCustomEndpoint`); her chat çağrısında
// ChatOptions.endpoint olarak Rust'a geçirilir. API key opsiyoneldir; gerekiyorsa
// DPAPI vault'ta saklanır (mevcut secrets sistemi).

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { fetchModels, streamChat } from './common';
import { useSettingsStore } from '@/stores/settings';

export class CustomProvider implements AIProvider {
  readonly id = 'custom' as const;
  readonly name = 'Özel Endpoint';

  async isAvailable(): Promise<boolean> {
    // Endpoint girilmişse aktif sayılır.
    const settings = useSettingsStore();
    return Boolean(settings.state.aiCustomEndpoint?.trim());
  }

  async models(): Promise<AIModel[]> {
    const settings = useSettingsStore();
    const endpoint = settings.state.aiCustomEndpoint?.trim();
    if (!endpoint) return [];
    // fetchModels endpoint geçmiyor — custom için Rust default_base_url boş;
    // models çağrısı boş dönecek. Manuel model id girilebilir (UI'de "Model
    // adı" text input). Liste yine de fetch'e denenir; başarısız olursa boş.
    return fetchModels('custom');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const settings = useSettingsStore();
    const endpoint = settings.state.aiCustomEndpoint?.trim();
    if (!endpoint) {
      // Error code formatı (frontend'de i18n'e mapping). Türkçe literal
      // İngilizce locale'de görünmesin diye ham string yerine kod fırlatıyoruz.
      throw new Error('noEndpoint');
    }
    return streamChat('custom', messages, { ...options, endpoint });
  }
}
