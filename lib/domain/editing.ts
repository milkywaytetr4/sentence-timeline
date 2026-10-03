import type { Sentence } from "./types";

/**
 * 問題編集画面の文・段落の操作。どれも元の配列を変更せず、新しい配列を返す。
 * id は保存済みの文の id（新しく分割してできた文は null）、key は画面上の識別子。
 */

export type EditRow = { key: string; id: string | null; text: string };
export type EditParagraph = { key: string; rows: EditRow[] };

export function fromSentences(
  sentences: readonly Sentence[],
  newKey: () => string,
): EditParagraph[] {
  const out: EditParagraph[] = [];
  let currentIndex: number | null = null;
  for (const s of sentences) {
    if (s.paragraphIndex !== currentIndex) {
      out.push({ key: newKey(), rows: [] });
      currentIndex = s.paragraphIndex;
    }
    out[out.length - 1].rows.push({ key: newKey(), id: s.id, text: s.text });
  }
  return out;
}

const join = (a: string, b: string) => `${a.trimEnd()} ${b.trimStart()}`.trim();

/** 文を直前の文に結合する。段落の先頭の文なら、前の段落の最後の文に結合する */
export function mergeWithPrevious(
  paras: readonly EditParagraph[],
  pi: number,
  si: number,
): EditParagraph[] {
  const next = paras.map((p) => ({ ...p, rows: [...p.rows] }));
  const row = next[pi]?.rows[si];
  if (!row) return [...paras];
  if (si > 0) {
    const prev = next[pi].rows[si - 1];
    next[pi].rows[si - 1] = { ...prev, text: join(prev.text, row.text) };
    next[pi].rows.splice(si, 1);
    return next;
  }
  if (pi === 0) return [...paras];
  const prevRows = next[pi - 1].rows;
  const last = prevRows[prevRows.length - 1];
  prevRows[prevRows.length - 1] = { ...last, text: join(last.text, row.text) };
  next[pi].rows.splice(0, 1);
  return next.filter((p) => p.rows.length > 0);
}

/** 文を pos の位置で2つに分ける。後ろ側は新しい文（id なし）になる */
export function splitAt(
  paras: readonly EditParagraph[],
  pi: number,
  si: number,
  pos: number,
  newKey: () => string,
): EditParagraph[] | null {
  const row = paras[pi]?.rows[si];
  if (!row) return null;
  const left = row.text.slice(0, pos).trim();
  const right = row.text.slice(pos).trim();
  if (!left || !right) return null;
  const next = paras.map((p) => ({ ...p, rows: [...p.rows] }));
  next[pi].rows.splice(
    si,
    1,
    { ...row, text: left },
    { key: newKey(), id: null, text: right },
  );
  return next;
}

/** 段落を前の段落につなげる */
export function joinWithPreviousParagraph(
  paras: readonly EditParagraph[],
  pi: number,
): EditParagraph[] {
  if (pi <= 0 || pi >= paras.length) return [...paras];
  const next = [...paras];
  next[pi - 1] = {
    ...next[pi - 1],
    rows: [...next[pi - 1].rows, ...next[pi].rows],
  };
  next.splice(pi, 1);
  return next;
}

/** si 番目の文から後ろを新しい段落にする */
export function startParagraphAt(
  paras: readonly EditParagraph[],
  pi: number,
  si: number,
  newKey: () => string,
): EditParagraph[] {
  const para = paras[pi];
  if (!para || si <= 0 || si >= para.rows.length) return [...paras];
  const next = [...paras];
  next.splice(
    pi,
    1,
    { ...para, rows: para.rows.slice(0, si) },
    { key: newKey(), rows: para.rows.slice(si) },
  );
  return next;
}

export function removeRow(
  paras: readonly EditParagraph[],
  pi: number,
  si: number,
): EditParagraph[] {
  return paras
    .map((p, i) =>
      i === pi ? { ...p, rows: p.rows.filter((_, j) => j !== si) } : p,
    )
    .filter((p) => p.rows.length > 0);
}

export function updateText(
  paras: readonly EditParagraph[],
  pi: number,
  si: number,
  text: string,
): EditParagraph[] {
  return paras.map((p, i) =>
    i === pi
      ? { ...p, rows: p.rows.map((r, j) => (j === si ? { ...r, text } : r)) }
      : p,
  );
}
