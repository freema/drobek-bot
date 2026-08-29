import { describe, expect, it } from "vitest";

import { findSecretLikeStrings, type SecretKind } from "./secrets.js";

function kinds(text: string): SecretKind[] {
  return findSecretLikeStrings(text).map((match) => match.kind);
}

describe("findSecretLikeStrings: what it reports", () => {
  it("reports an Anthropic API key", () => {
    const matches = findSecretLikeStrings("token: sk-ant-abcdefgh12345");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("anthropic-api-key");
    expect(matches[0]?.line).toBe(1);
  });

  it("reports a generic secret key (sk- plus 20+ characters)", () => {
    expect(kinds(`sk-${"a".repeat(20)}`)).toEqual(["secret-key"]);
  });

  it("reports a GitHub personal access token, classic and fine-grained", () => {
    expect(kinds("ghp_12345678")).toEqual(["github-token"]);
    expect(kinds("github_pat_12345678")).toEqual(["github-token"]);
  });

  it("reports a GitLab token", () => {
    expect(kinds("glpat-12345678")).toEqual(["gitlab-token"]);
  });

  it("reports an AWS access key id", () => {
    expect(kinds("AKIAABCDEFGHIJKLMNOP")).toEqual(["aws-access-key-id"]);
  });

  it("reports a Slack token, bot and user", () => {
    expect(kinds("xoxb-1234-5678")).toEqual(["slack-token"]);
    expect(kinds("xoxp-1234-5678")).toEqual(["slack-token"]);
  });

  it("reports a PEM private key header", () => {
    expect(kinds("-----BEGIN RSA PRIVATE KEY-----")).toEqual(["private-key"]);
    expect(kinds("-----BEGIN PRIVATE KEY-----")).toEqual(["private-key"]);
  });

  it("reports the line and kind of every match, in document order", () => {
    const text = ["nothing here", "ghp_aaaaaaaa", "still nothing", "glpat-bbbbbbbb"].join("\n");
    const matches = findSecretLikeStrings(text);
    expect(matches.map((match) => ({ line: match.line, kind: match.kind }))).toEqual([
      { line: 2, kind: "github-token" },
      { line: 4, kind: "gitlab-token" },
    ]);
  });
});

describe("findSecretLikeStrings: what it does not report", () => {
  it("does not report ordinary prose", () => {
    expect(kinds("The weather today is nice and the meeting is at three.")).toEqual([]);
  });

  it("does not report sk-ant without a key body", () => {
    expect(kinds("configure sk-ant carefully")).toEqual([]);
  });

  it("does not report a short sk- token", () => {
    expect(kinds("sk-short")).toEqual([]);
  });

  it("does not report AKIA glued inside a longer word", () => {
    expect(kinds("XAKIAABCDEFGHIJKLMNOP")).toEqual([]);
  });
});

describe("findSecretLikeStrings: preview", () => {
  it("never contains the full secret, at most 7 characters", () => {
    const secret = `sk-ant-${"a".repeat(40)}`;
    const matches = findSecretLikeStrings(secret);
    expect(matches).toHaveLength(1);
    const preview = matches[0]?.preview ?? "";
    expect(preview).not.toContain(secret);
    expect(preview.endsWith("...")).toBe(true);
    expect(preview.slice(0, -3).length).toBeLessThanOrEqual(7);
  });
});

describe("findSecretLikeStrings: overlap between the Anthropic and generic patterns", () => {
  it("reports only the more specific anthropic-api-key kind, not also secret-key", () => {
    const matches = findSecretLikeStrings(`sk-ant-${"a".repeat(30)}`);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("anthropic-api-key");
  });
});
