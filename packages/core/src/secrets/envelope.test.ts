import { describe, expect, it } from "vitest";

import { deriveKeyId, openSecretText, parseMasterKey, sealSecret } from "./envelope.js";

const kek = parseMasterKey(Buffer.alloc(32, 7).toString("base64"));
const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  botId: "22222222-2222-4222-8222-222222222222",
  name: "GITHUB_TOKEN",
};

describe("sealSecret / openSecret", () => {
  it("opens what it sealed, in the same scope, under the derived key id", () => {
    const envelope = sealSecret({ kek, plaintext: "not-a-real-token-value", scope });
    expect(envelope.keyId).toBe(deriveKeyId(kek));
    expect(openSecretText({ kek, envelope, scope })).toBe("not-a-real-token-value");
  });
});
