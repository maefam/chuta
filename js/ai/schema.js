// AI応答の形。Claude の output_config.format と OpenAI の response_format で共有する。
// 数値制約・文字列長制約は使えないので書かない。全オブジェクトに additionalProperties:false と required を付ける。

export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    choices: { type: "array", items: { type: "string" } },
    expect: { type: "string", enum: ["choice", "number", "photo", "text", "none"] },
    unit: { type: "string" },
    phase: { type: "string", enum: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] },
    hint_level: { type: "integer", enum: [0, 1, 2, 3] },
    done: { type: "boolean" },
    handoff: { type: "string" },
    call_parent: { type: "boolean" },
    report: { type: "string" },
    knowledge_suggestion: { type: "string" },
    notes: {
      type: "object",
      properties: {
        subject: { type: "string" },
        unit_name: { type: "string" },
        problem: { type: "string" },
        answer: { type: "string" },
        prereq: { type: "array", items: { type: "string" } },
        diagnosis: { type: "string" },
        error_type: { type: "string" },
      },
      required: ["subject", "unit_name", "problem", "answer", "prereq", "diagnosis", "error_type"],
      additionalProperties: false,
    },
  },
  required: ["say", "choices", "expect", "unit", "phase", "hint_level", "done", "handoff", "call_parent", "report", "knowledge_suggestion", "notes"],
  additionalProperties: false,
};

// 受け取ったオブジェクトが契約を満たすか確かめる。満たさなければ理由を文字列で返す。満たせば null。
export function validateReply(o) {
  if (!o || typeof o !== "object") return "オブジェクトではない";
  if (typeof o.say !== "string" || o.say.trim() === "") return "say が空";
  if (!Array.isArray(o.choices) || o.choices.some((c) => typeof c !== "string")) return "choices が不正";
  if (!["choice", "number", "photo", "text", "none"].includes(o.expect)) return "expect が不正";
  if (typeof o.unit !== "string") return "unit が不正";
  if (!["S1", "S2", "S3", "S4", "S5", "S6", "S7"].includes(o.phase)) return "phase が不正";
  if (!Number.isInteger(o.hint_level) || o.hint_level < 0 || o.hint_level > 3) return "hint_level が不正";
  if (typeof o.done !== "boolean") return "done が不正";
  if (typeof o.handoff !== "string") return "handoff が不正";
  if (typeof o.call_parent !== "boolean") return "call_parent が不正";
  if (typeof o.report !== "string") return "report が不正";
  if (typeof o.knowledge_suggestion !== "string") return "knowledge_suggestion が不正";
  const n = o.notes;
  if (!n || typeof n !== "object") return "notes がない";
  for (const k of ["subject", "unit_name", "problem", "answer", "diagnosis", "error_type"]) {
    if (typeof n[k] !== "string") return `notes.${k} が不正`;
  }
  if (!Array.isArray(n.prereq)) return "notes.prereq が不正";
  return null;
}
