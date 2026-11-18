import { cleanCnpj, validDate } from "./domain.mjs";
const SCALE = 1000000n;
export class ImportError extends Error {}
const fail = (message) => {
  throw new ImportError(message);
};
export function quantity(value) {
  const s = String(value ?? "").trim();
  if (!/^[+-]?\d+(?:[.,]\d{1,6})?$/.test(s) || s.length > 32)
    fail(
      `Quantidade inválida: “${s.slice(0, 35)}”. Use até 6 casas decimais, sem separador de milhar.`,
    );
  const negative = s.startsWith("-"),
    unsigned = s.replace(/^[+-]/, "").replace(",", ".");
  const [whole, fraction = ""] = unsigned.split(".");
  const v = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -v : v;
}
export function displayQuantity(value) {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const fraction = (v % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return (
    (negative ? "-" : "") +
    (v / SCALE).toString() +
    (fraction ? "." + fraction : "")
  );
}
function dateFromSped(s) {
  if (!/^\d{8}$/.test(s)) fail("Data de inventário H005 inválida.");
  const date = s.slice(4) + "-" + s.slice(2, 4) + "-" + s.slice(0, 2);
  if (!validDate(date)) fail("Data de inventário H005 inválida.");
  return date;
}
function accumulate(map, code, unit, qty) {
  code = code.trim();
  unit = unit.trim().toUpperCase();
  if (!code || code.length > 100 || !unit || unit.length > 20)
    fail("Código ou unidade de produto inválidos.");
  const previous = map.get(code);
  if (previous && previous.unit !== unit)
    fail(
      `O produto ${code} possui mais de uma unidade no mesmo arquivo. Padronize as unidades antes de importar.`,
    );
  map.set(code, { code, unit, quantity: (previous?.quantity || 0n) + qty });
  if (map.size > 10000)
    fail("O limite desta versão é de 10.000 produtos por conciliação.");
}
export function readSped(input, expectedCnpj, inventoryDate) {
  if (typeof input !== "string" || !input.trim())
    fail("Selecione um arquivo EFD não vazio.");
  if (!validDate(inventoryDate)) fail("Selecione a data-base do inventário.");
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/),
    map = new Map();
  let header = false,
    active = false,
    selected = 0,
    excluded = 0,
    detailCount = 0;
  for (const raw of lines) {
    const parts = raw.trim().split("|");
    if (parts[1] === "0000") {
      if (header)
        fail(
          "O arquivo contém mais de um registro 0000. Importe uma escrituração por vez.",
        );
      header = true;
      if (cleanCnpj(parts[7]) !== cleanCnpj(expectedCnpj))
        fail("O CNPJ da EFD não corresponde à empresa selecionada.");
    }
    if (parts[1] === "H005") {
      active = dateFromSped(parts[2]) === inventoryDate;
      if (active && ++selected > 1)
        fail(
          "Há mais de um inventário H005 na mesma data. Separe os inventários antes de conciliar.",
        );
    }
    if (parts[1] === "H010" && active) {
      detailCount++;
      if (!["0", "1", "2"].includes(parts[7]))
        fail("Indicador de propriedade H010 inválido.");
      if (parts[7] !== "0") {
        excluded++;
        continue;
      }
      accumulate(map, parts[2] || "", parts[3] || "", quantity(parts[4]));
    }
  }
  if (!header) fail("Arquivo sem registro 0000 da EFD ICMS/IPI.");
  if (!selected) fail("Não existe inventário H005 para a data-base informada.");
  if (!detailCount) fail("O inventário selecionado não contém registros H010.");
  if (!map.size)
    fail(
      "Não há estoque próprio em poder da empresa (IND_PROP=0) neste inventário.",
    );
  return { items: map, excluded };
}
export function parseCsv(input) {
  if (typeof input !== "string" || !input.trim())
    fail("Selecione um CSV não vazio.");
  input = input.replace(/^\uFEFF/, "");
  const first = input.split(/\r?\n/)[0];
  const delimiter = first.includes(";") ? ";" : ",";
  const rows = [];
  let row = [],
    value = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else value += c;
      continue;
    }
    if (c === '"') {
      if (value || closed) fail("CSV com aspas inválidas.");
      quoted = true;
      continue;
    }
    if (c === delimiter) {
      row.push(value);
      value = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      value = "";
      closed = false;
    } else {
      if (closed && c.trim())
        fail("CSV com caracteres após o fechamento de aspas.");
      if (!closed) value += c;
    }
    if (rows.length > 20000) fail("O CSV excede 20.000 linhas.");
  }
  if (quoted) fail("CSV com aspas não fechadas.");
  row.push(value);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function readErpCsv(input) {
  const rows = parseCsv(input);
  const normalized = rows.shift()?.map((x) =>
    x
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
  );
  const columns = ["codigo", "unidade", "quantidade"].map(
    (name) => normalized?.indexOf(name) ?? -1,
  );
  if (
    columns.some((i) => i < 0) ||
    new Set(normalized).size !== normalized.length
  )
    fail("O CSV deve ter cabeçalhos únicos: codigo;unidade;quantidade.");
  const map = new Map();
  for (const [i, row] of rows.entries()) {
    if (row.length !== normalized.length)
      fail(`A linha ${i + 2} do CSV tem uma quantidade incorreta de colunas.`);
    accumulate(
      map,
      row[columns[0]],
      row[columns[1]],
      quantity(row[columns[2]]),
    );
  }
  if (!map.size) fail("O CSV não contém produtos.");
  return map;
}
export function reconcileStock({ efd, erp, cnpj, inventoryDate }) {
  const fiscal = readSped(efd, cnpj, inventoryDate),
    erpItems = readErpCsv(erp),
    codes = [...new Set([...fiscal.items.keys(), ...erpItems.keys()])].sort();
  if (codes.length > 10000) fail("O resultado excede 10.000 produtos.");
  const items = codes.map((code) => {
    const f = fiscal.items.get(code),
      e = erpItems.get(code);
    const comparable = f && e && f.unit === e.unit;
    return {
      code,
      fiscal_unit: f?.unit ?? null,
      erp_unit: e?.unit ?? null,
      fiscal_quantity: f ? displayQuantity(f.quantity) : null,
      erp_quantity: e ? displayQuantity(e.quantity) : null,
      difference: comparable ? displayQuantity(e.quantity - f.quantity) : null,
      status: !f
        ? "only_erp"
        : !e
          ? "only_fiscal"
          : f.unit !== e.unit
            ? "unit_mismatch"
            : f.quantity < 0n || e.quantity < 0n
              ? "negative_stock"
              : e.quantity === f.quantity
                ? "matched"
                : "quantity_mismatch",
    };
  });
  return {
    inventory_date: inventoryDate,
    excluded_count: fiscal.excluded,
    items,
    total_count: items.length,
    matched_count: items.filter((i) => i.status === "matched").length,
  };
}
