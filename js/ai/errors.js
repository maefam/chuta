// AI呼び出しの失敗を表す。provider.js と各プロバイダ実装の循環参照を避けるため独立させている。
export class AiError extends Error {
  constructor({ code, message, detail }) {
    super(message || code);
    this.name = "AiError";
    this.code = code; // 'auth'|'network'|'cors'|'format'|'limit'
    this.detail = detail;
  }
}
