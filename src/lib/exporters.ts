import type { Project } from '../types';
import { getExpandedMeasures } from './measures';
import { getChordName } from './musicTheory';

/** 参照を展開し、実効設定を確定させた書き出し用の小節 */
interface FlatMeasure {
  /** スロットごとのコード名。コードが置かれていないスロットは null */
  chordNames: (string | null)[];
  key: string;
  tempo: number;
  timeSignature: [number, number];
}

/**
 * 参照小節を展開したうえで、各小節の実効設定を先頭から継承して確定させる。
 * 再生側（scheduler.buildTimeline）と同じ順序・同じ継承規則で並べる。
 */
function flatten(project: Project): FlatMeasure[] {
  let key = project.key || 'C';
  let tempo = project.tempo || 120;
  let timeSignature = project.timeSignature || ([4, 4] as [number, number]);

  return getExpandedMeasures(project).map(({ measure }) => {
    if (measure.key) key = measure.key;
    if (measure.tempo) tempo = measure.tempo;
    if (measure.timeSignature) timeSignature = measure.timeSignature;

    const chordNames = measure.slots.map((slot) =>
      slot.chordId ? getChordName(project.chords[slot.chordId]) : null,
    );
    return { chordNames, key, tempo, timeSignature };
  });
}

/**
 * スロット列を情報を落とさずに畳む。
 * 1 / 2 / 4 / 8 等分したときに各グループが同じコードで埋まっていれば、
 * グループ1つを1トークンにまとめる。畳めなければそのまま返す。
 */
function compressSlots(tokens: string[]): string[] {
  for (const groups of [1, 2, 4, 8]) {
    if (groups >= tokens.length || tokens.length % groups !== 0) continue;
    const size = tokens.length / groups;
    const uniform = tokens.every((token, i) => token === tokens[Math.floor(i / size) * size]);
    if (uniform) return Array.from({ length: groups }, (_, g) => tokens[g * size]);
  }
  return tokens;
}

/**
 * rechord.cc 形式。
 * コードのないスロットは直前のコードを引き継ぎ、曲頭は `_` とする。
 * 畳んだあと直前と同じコードは `=` に置き換え、小節は ` | ` 区切りで4小節ごとに改行する。
 */
export function toRechord(project: Project): string {
  const measures = flatten(project);
  const head = measures[0];
  const lines = [
    `# Title: ${project.name}`,
    `# Key: ${head?.key ?? project.key}`,
    `# BPM: ${head?.tempo ?? project.tempo}`,
    `# Meter: ${(head?.timeSignature ?? project.timeSignature).join('/')}`,
    '',
  ];

  let carried = '_'; // 直前に鳴っているコード（小節をまたいで持ち越す）
  let previous: string | null = null; // 直前に出力したトークン
  const bars = measures.map((measure) => {
    const filled = measure.chordNames.map((name) => {
      if (name) carried = name;
      return carried;
    });
    return compressSlots(filled)
      .map((token) => {
        const output = token === previous ? '=' : token;
        previous = token;
        return output;
      })
      .join(' ');
  });

  for (let i = 0; i < bars.length; i += 4) {
    lines.push(bars.slice(i, i + 4).join(' | '));
  }
  return lines.join('\r\n');
}

const BARS_PER_LINE = 4;

/**
 * ChordPro 形式。
 * コードが変化したスロットだけを `[C]` として出力し、
 * 途中で key / tempo / 拍子が変わればその位置にディレクティブ行を挟む。
 */
export function toChordPro(project: Project): string {
  const measures = flatten(project);
  const head = measures[0];
  let key = head?.key ?? project.key;
  let tempo = head?.tempo ?? project.tempo;
  let timeSignature = head?.timeSignature ?? project.timeSignature;

  const lines: string[] = [
    `{title: ${project.name}}`,
    `{key: ${key}}`,
    `{tempo: ${tempo}}`,
    `{time: ${timeSignature[0]}/${timeSignature[1]}}`,
    '',
  ];

  let bars: string[] = [];
  const flush = () => {
    if (bars.length === 0) return;
    lines.push(bars.join(' '));
    bars = [];
  };

  let previous: string | null = null;
  measures.forEach((measure) => {
    const directives: string[] = [];
    if (measure.key !== key) {
      key = measure.key;
      directives.push(`{key: ${key}}`);
    }
    if (measure.tempo !== tempo) {
      tempo = measure.tempo;
      directives.push(`{tempo: ${tempo}}`);
    }
    if (
      measure.timeSignature[0] !== timeSignature[0] ||
      measure.timeSignature[1] !== timeSignature[1]
    ) {
      timeSignature = measure.timeSignature;
      directives.push(`{time: ${timeSignature[0]}/${timeSignature[1]}}`);
    }
    if (directives.length > 0) {
      // 行の途中なら一度改行してからディレクティブを置く
      flush();
      lines.push(...directives, '');
    }

    const tokens: string[] = [];
    measure.chordNames.forEach((name) => {
      if (!name || name === previous) return;
      tokens.push(`[${name}]`);
      previous = name;
    });

    bars.push(tokens.length > 0 ? `${tokens.join(' ')} |` : '|');
    if (bars.length === BARS_PER_LINE) flush();
  });
  flush();

  return lines.join('\n');
}
