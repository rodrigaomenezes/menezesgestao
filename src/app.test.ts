import { describe, expect, it } from "vitest";
import { criarApp } from "./app.js";

describe("health", () => {
  it("responde ok", async () => {
    const res = await criarApp().inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
