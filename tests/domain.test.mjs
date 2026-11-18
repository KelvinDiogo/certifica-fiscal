import test from "node:test";
import assert from "node:assert/strict";
import {
  validCnpj,
  certificateState,
  latestCertificates,
  csvCell,
  validDate,
} from "../lib/domain.mjs";
test("validates numeric and alphanumeric CNPJs, rejecting malformed check digits", () => {
  assert.equal(validCnpj("11.222.333/0001-81"), true);
  assert.equal(validCnpj("12.ABC.345/01DE-35"), true);
  for (const c of [
    "00000000000000",
    "11111111111111",
    "11.222.333/0001-80",
    "11+222333000181",
    "",
  ])
    assert.equal(validCnpj(c), false, c);
});
test("expiration overrides a negative document; CPEN remains legally regular while current", () => {
  assert.equal(
    certificateState(
      { result: "negativa", expires_at: "2026-10-31" },
      "2026-11-17",
    ),
    "expired",
  );
  assert.equal(
    certificateState(
      { result: "positiva_efeitos_negativa", expires_at: "2027-02-01" },
      "2026-11-17",
    ),
    "regular",
  );
  assert.equal(
    certificateState(
      { result: "positiva", expires_at: "2027-02-01" },
      "2026-11-17",
    ),
    "irregular",
  );
  assert.equal(
    certificateState(
      { result: "nao_verificada", expires_at: "2027-02-01" },
      "2026-11-17",
    ),
    "unknown",
  );
});
test("expiry boundary includes today and the 30-day window", () => {
  for (const expires_at of ["2026-11-17", "2026-12-17"])
    assert.equal(
      certificateState({ result: "negativa", expires_at }, "2026-11-17"),
      "expiring",
    );
  assert.equal(
    certificateState(
      { result: "negativa", expires_at: "2026-12-18" },
      "2026-11-17",
    ),
    "regular",
  );
});
test("dashboard selects latest issue per company and type without hiding historical rows", () => {
  const old = {
    id: "old",
    company_id: "a",
    type: "federal",
    issued_at: "2026-01-01",
    created_at: "2026-03-01",
  };
  const newer = {
    ...old,
    id: "new",
    issued_at: "2026-02-01",
    created_at: "2026-02-01",
  };
  const second = { ...old, id: "b", company_id: "b" };
  assert.deepEqual(
    new Set(latestCertificates([newer, old, second]).map((c) => c.id)),
    new Set(["new", "b"]),
  );
});
test("CSV neutralizes spreadsheet formula injection and escapes quotes", () => {
  assert.equal(csvCell(' =HYPERLINK("x")'), '"\' =HYPERLINK(""x"")"');
  assert.equal(csvCell("Empresa, Ltda"), '"Empresa, Ltda"');
});
test("invalid calendar dates are rejected", () => {
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-2-1"), false);
});
