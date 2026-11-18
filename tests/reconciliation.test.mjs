import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileStock,
  quantity,
  displayQuantity,
  parseCsv,
} from "../lib/reconciliation.mjs";
const cnpj = "11222333000181",
  date = "2026-10-31";
const header = "|0000|019|0|01102026|31102026|Empresa|" + cnpj + "||SP|";
const efd = (rows, dt = "31102026") =>
  header +
  "\n|H005|" +
  dt +
  "|100|01|\n" +
  rows
    .map(
      ([code, unit, qty, owner = "0"]) =>
        `|H010|${code}|${unit}|${qty}|1|10|${owner}||||`,
    )
    .join("\n");
const run = (rows, csv, extra = {}) =>
  reconcileStock({
    efd: efd(rows),
    erp: csv,
    cnpj,
    inventoryDate: date,
    ...extra,
  });
test("compares decimal quantities exactly without floating-point errors", () => {
  const r = run(
    [
      ["A", "KG", "0,1"],
      ["A", "KG", "0,2"],
    ],
    "codigo;unidade;quantidade\nA;KG;0,3",
  );
  assert.equal(r.matched_count, 1);
  assert.equal(r.items[0].difference, "0");
  assert.equal(r.items[0].fiscal_quantity, "0.3");
});
test("detects missing products, mismatched units and stock quantity differences", () => {
  const r = run(
    [
      ["A", "UN", "10"],
      ["B", "KG", "2"],
      ["C", "UN", "4"],
    ],
    "codigo;unidade;quantidade\nA;UN;9\nB;CX;2\nD;UN;1",
  );
  assert.deepEqual(
    r.items.map((i) => i.status),
    ["quantity_mismatch", "unit_mismatch", "only_fiscal", "only_erp"],
  );
  assert.equal(r.items[0].difference, "-1");
  assert.equal(r.items[1].difference, null);
});
test("negative inventory is flagged even if both sides match", () => {
  assert.equal(
    run([["A", "UN", "-1"]], "codigo;unidade;quantidade\nA;UN;-1").items[0]
      .status,
    "negative_stock",
  );
});
test("rejects a different CNPJ or missing inventory date", () => {
  assert.throws(
    () =>
      run([["A", "UN", "1"]], "codigo;unidade;quantidade\nA;UN;1", {
        cnpj: "12345678000195",
      }),
    /CNPJ/,
  );
  assert.throws(
    () =>
      run([["A", "UN", "1"]], "codigo;unidade;quantidade\nA;UN;1", {
        inventoryDate: "2026-10-30",
      }),
    /H005/,
  );
});
test("selects the explicit H005 inventory and excludes third-party stock", () => {
  const input =
    efd([
      ["A", "UN", "10"],
      ["A", "UN", "90", "1"],
      ["B", "UN", "80", "2"],
    ]) + "\n|H005|30102026|10|01|\n|H010|A|UN|99|1|99|0||||";
  const r = run([], "codigo;unidade;quantidade\nA;UN;10", { efd: input });
  assert.equal(r.excluded_count, 2);
  assert.equal(r.matched_count, 1);
  assert.equal(r.items[0].fiscal_quantity, "10");
});
test("rejects ambiguous duplicate inventories and mixed units for one code", () => {
  assert.throws(
    () =>
      run([], "codigo;unidade;quantidade\nA;UN;1", {
        efd:
          efd([["A", "UN", "1"]]) +
          "\n|H005|31102026|10|01|\n|H010|A|UN|1|1|1|0||||",
      }),
    /mais de um inventário/,
  );
  assert.throws(
    () =>
      run(
        [
          ["A", "UN", "1"],
          ["A", "KG", "1"],
        ],
        "codigo;unidade;quantidade\nA;UN;1",
      ),
    /mais de uma unidade/,
  );
});
test("CSV supports quoted semicolons, escaped quotes, comma delimiter and BOM", () => {
  assert.deepEqual(
    parseCsv('\uFEFFcodigo;unidade;quantidade\n"A;B";UN;"1,5"'),
    [
      ["codigo", "unidade", "quantidade"],
      ["A;B", "UN", "1,5"],
    ],
  );
  assert.equal(
    run([["A", "UN", "2"]], "codigo,unidade,quantidade\nA,UN,2").matched_count,
    1,
  );
  assert.deepEqual(parseCsv('a;b\n"x""y";z'), [
    ["a", "b"],
    ['x"y', "z"],
  ]);
});
test("malformed or duplicate CSV headers and incomplete rows fail explicitly", () => {
  for (const csv of [
    'codigo;unidade;quantidade\n"A;UN;1',
    "codigo;unidade;quantidade\nA;UN",
    "codigo;codigo;quantidade\nA;UN;1",
    "produto;unidade;saldo\nA;UN;1",
  ])
    assert.throws(() => run([["A", "UN", "1"]], csv));
});
test("quantity parser rejects thousands separators and excess precision; serializes big integers", () => {
  for (const q of ["1.234,50", "1,234.50", "1e3", "NaN", "1,1234567", ""])
    assert.throws(() => quantity(q));
  assert.equal(
    displayQuantity(quantity("1234567890123456789,123456")),
    "1234567890123456789.123456",
  );
  assert.equal(displayQuantity(quantity("-0,000001")), "-0.000001");
});
