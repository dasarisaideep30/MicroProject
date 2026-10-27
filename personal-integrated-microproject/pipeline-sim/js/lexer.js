/* ================================================================
 * lexer.js — DFA-based assembly tokenizer
 * FLAT component (Modules 1–2): Deterministic Finite Automaton
 * ================================================================
 * The DFA has 8 named states:
 *   START → IDENT | REG_R | IMM_SIGN | IMM_DIG | HASH |
 *           LPAREN | RPAREN | COMMA | COLON | COMMENT | ERROR
 *
 * Transition function δ is coded as an explicit object so we can
 * dump it to the UI as a table (same style as the FLAT project).
 * ================================================================ */

const TokenType = Object.freeze({
  OPCODE:   'OPCODE',
  REGISTER: 'REGISTER',
  IMMEDIATE:'IMMEDIATE',
  LABEL_DEF:'LABEL_DEF',   // foo:
  LABEL_REF:'LABEL_REF',   // foo  (used as operand)
  LPAREN:   'LPAREN',
  RPAREN:   'RPAREN',
  COMMA:    'COMMA',
  NEWLINE:  'NEWLINE',
  EOF:      'EOF',
  ERROR:    'ERROR',
});

/* ── known opcodes (RISC subset) ── */
const OPCODES = new Set([
  'ADD','SUB','MUL','AND','OR','XOR','SLL','SRL',   // R-type
  'ADDI','SUBI','ANDI','ORI',                        // I-type
  'LW','SW',                                         // memory
  'BEQ','BNE','BLT','BGE',                           // branch
  'JAL','JALR',                                      // jump
  'NOP','HLT',                                       // control
]);

/* ── DFA states ── */
const S = Object.freeze({
  START:0, IDENT:1, REG_R:2, REG_DIG:3,
  IMM_SIGN:4, IMM_DIG:5, HASH:6,
  LPAREN:7, RPAREN:8, COMMA:9, COLON:10,
  COMMENT:11, ERROR:12, WS:13,
});

const S_NAME = Object.keys(S);

/* ── Character classifier ── */
function charClass(c) {
  if (c === undefined || c === '') return 'eof';
  if (c === '\n' || c === '\r')  return 'nl';
  if (c === ' ' || c === '\t')   return 'ws';
  if (c === '#')  return 'hash';
  if (c === ',')  return 'comma';
  if (c === '(')  return 'lp';
  if (c === ')')  return 'rp';
  if (c === ':')  return 'colon';
  if (c === '-' || c === '+') return 'sign';
  if (c >= '0' && c <= '9')  return 'digit';
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') return 'alpha';
  return 'other';
}

/* ── Build transition table (explicit δ) ── */
function buildDelta() {
  // delta[state][charClass] → nextState
  const d = {};
  for (const s of Object.values(S)) {
    d[s] = {};
    // default: everything goes to ERROR
    for (const cc of ['alpha','digit','sign','hash','comma','lp','rp','colon','ws','nl','eof','other'])
      d[s][cc] = S.ERROR;
  }

  // START
  d[S.START]['alpha'] = S.IDENT;
  d[S.START]['digit'] = S.IMM_DIG;
  d[S.START]['sign']  = S.IMM_SIGN;
  d[S.START]['hash']  = S.COMMENT;
  d[S.START]['comma'] = S.COMMA;
  d[S.START]['lp']    = S.LPAREN;
  d[S.START]['rp']    = S.RPAREN;
  d[S.START]['ws']    = S.WS;
  d[S.START]['nl']    = S.START; // consume newlines at start
  d[S.START]['eof']   = S.START;

  // IDENT: alpha | digit | underscore
  d[S.IDENT]['alpha'] = S.IDENT;
  d[S.IDENT]['digit'] = S.IDENT;

  // IMM_SIGN: must be followed by digit
  d[S.IMM_SIGN]['digit'] = S.IMM_DIG;

  // IMM_DIG: more digits
  d[S.IMM_DIG]['digit'] = S.IMM_DIG;

  // COMMENT: eat everything until newline
  for (const cc of ['alpha','digit','sign','hash','comma','lp','rp','colon','ws','other'])
    d[S.COMMENT][cc] = S.COMMENT;

  // WS: skip whitespace
  d[S.WS]['ws'] = S.WS;

  return d;
}

const DELTA = buildDelta();

/* ── Tokenize ── */
function tokenize(source) {
  const tokens = [];
  const errors = [];
  let pos = 0;
  const lines = source.split('\n');

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];
    pos = 0;

    while (pos <= line.length) {
      // skip whitespace
      while (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) pos++;
      if (pos >= line.length) break;

      const c = line[pos];
      const cc = charClass(c);

      // comment — skip rest of line
      if (cc === 'hash') break;

      // single-char tokens
      if (cc === 'comma') { tokens.push({ type: TokenType.COMMA, value: ',', line: lineNo }); pos++; continue; }
      if (cc === 'lp')    { tokens.push({ type: TokenType.LPAREN, value: '(', line: lineNo }); pos++; continue; }
      if (cc === 'rp')    { tokens.push({ type: TokenType.RPAREN, value: ')', line: lineNo }); pos++; continue; }

      // identifier or register or opcode or label
      if (cc === 'alpha') {
        let state = S.IDENT;
        const start = pos;
        pos++;
        while (pos < line.length) {
          const nc = charClass(line[pos]);
          const ns = DELTA[state][nc];
          if (ns === S.IDENT) { pos++; continue; }
          break;
        }
        let word = line.slice(start, pos).toUpperCase();
        const rawWord = line.slice(start, pos);

        // check if followed by colon → label definition
        if (pos < line.length && line[pos] === ':') {
          tokens.push({ type: TokenType.LABEL_DEF, value: rawWord, line: lineNo });
          pos++; // consume colon
          continue;
        }

        // register: R0–R31 or X0–X31
        if (/^(R|X)\d{1,2}$/i.test(rawWord)) {
          const rn = parseInt(rawWord.slice(1));
          if (rn >= 0 && rn <= 31) {
            tokens.push({ type: TokenType.REGISTER, value: 'R' + rn, line: lineNo, regNum: rn });
            continue;
          }
        }

        // opcode
        if (OPCODES.has(word)) {
          tokens.push({ type: TokenType.OPCODE, value: word, line: lineNo });
          continue;
        }

        // otherwise it's a label reference
        tokens.push({ type: TokenType.LABEL_REF, value: rawWord, line: lineNo });
        continue;
      }

      // immediate: optional sign + digits
      if (cc === 'digit' || cc === 'sign') {
        const start = pos;
        pos++;
        while (pos < line.length && charClass(line[pos]) === 'digit') pos++;
        const val = line.slice(start, pos);
        const num = parseInt(val, 10);
        if (isNaN(num)) {
          errors.push({ msg: `Bad immediate "${val}"`, line: lineNo });
          tokens.push({ type: TokenType.ERROR, value: val, line: lineNo });
        } else {
          tokens.push({ type: TokenType.IMMEDIATE, value: num, line: lineNo });
        }
        continue;
      }

      // unknown character
      errors.push({ msg: `Unexpected character '${c}'`, line: lineNo });
      pos++;
    }

    // end of line
    if (tokens.length > 0 && tokens[tokens.length - 1].type !== TokenType.NEWLINE) {
      tokens.push({ type: TokenType.NEWLINE, value: '\\n', line: lineNo });
    }
  }

  tokens.push({ type: TokenType.EOF, value: '', line: lines.length - 1 });
  return { tokens, errors };
}

/* ── Parser: tokens → instruction list ── */
const InsnFormat = Object.freeze({
  R_TYPE: 'R_TYPE',   // OP rd, rs1, rs2
  I_TYPE: 'I_TYPE',   // OP rd, rs1, imm
  LOAD:   'LOAD',     // LW rd, imm(rs1)
  STORE:  'STORE',    // SW rs2, imm(rs1)
  BRANCH: 'BRANCH',   // BEQ rs1, rs2, label/imm
  JUMP:   'JUMP',     // JAL rd, label/imm
  NOP:    'NOP',
  HLT:    'HLT',
});

const OPCODE_FORMAT = {
  'ADD': InsnFormat.R_TYPE, 'SUB': InsnFormat.R_TYPE, 'MUL': InsnFormat.R_TYPE,
  'AND': InsnFormat.R_TYPE, 'OR': InsnFormat.R_TYPE,  'XOR': InsnFormat.R_TYPE,
  'SLL': InsnFormat.R_TYPE, 'SRL': InsnFormat.R_TYPE,
  'ADDI': InsnFormat.I_TYPE,'SUBI': InsnFormat.I_TYPE,
  'ANDI': InsnFormat.I_TYPE,'ORI': InsnFormat.I_TYPE,
  'LW': InsnFormat.LOAD,    'SW': InsnFormat.STORE,
  'BEQ': InsnFormat.BRANCH, 'BNE': InsnFormat.BRANCH,
  'BLT': InsnFormat.BRANCH, 'BGE': InsnFormat.BRANCH,
  'JAL': InsnFormat.JUMP,   'JALR': InsnFormat.JUMP,
  'NOP': InsnFormat.NOP,    'HLT': InsnFormat.HLT,
};

function parse(tokens) {
  const instructions = [];
  const parseErrors = [];
  let i = 0;

  function peek()    { return tokens[i]; }
  function advance() { return tokens[i++]; }
  function expect(type) {
    const t = advance();
    if (t.type !== type) {
      parseErrors.push({ msg: `Expected ${type}, got ${t.type} "${t.value}"`, line: t.line });
      return null;
    }
    return t;
  }
  function skipCommas() { while (peek() && peek().type === TokenType.COMMA) advance(); }
  function skipNewlines() { while (peek() && peek().type === TokenType.NEWLINE) advance(); }

  while (i < tokens.length) {
    skipNewlines();
    const t = peek();
    if (!t || t.type === TokenType.EOF) break;

    // label definition
    if (t.type === TokenType.LABEL_DEF) {
      const lbl = advance();
      // labels are resolved later for branches
      instructions.push({ format: 'LABEL', label: lbl.value, line: lbl.line, pc: instructions.length });
      continue;
    }

    if (t.type !== TokenType.OPCODE) {
      parseErrors.push({ msg: `Expected opcode, got "${t.value}"`, line: t.line });
      advance();
      continue;
    }

    const op = advance();
    const fmt = OPCODE_FORMAT[op.value];
    const insn = { op: op.value, format: fmt, line: op.line, raw: op.value };

    switch (fmt) {
      case InsnFormat.R_TYPE: {
        const rd = expect(TokenType.REGISTER); skipCommas();
        const rs1 = expect(TokenType.REGISTER); skipCommas();
        const rs2 = expect(TokenType.REGISTER);
        if (rd && rs1 && rs2) {
          insn.rd = rd.regNum; insn.rs1 = rs1.regNum; insn.rs2 = rs2.regNum;
          insn.raw = `${op.value} R${insn.rd}, R${insn.rs1}, R${insn.rs2}`;
        }
        break;
      }
      case InsnFormat.I_TYPE: {
        const rd = expect(TokenType.REGISTER); skipCommas();
        const rs1 = expect(TokenType.REGISTER); skipCommas();
        const imm = expect(TokenType.IMMEDIATE);
        if (rd && rs1 && imm) {
          insn.rd = rd.regNum; insn.rs1 = rs1.regNum; insn.imm = imm.value;
          insn.raw = `${op.value} R${insn.rd}, R${insn.rs1}, ${insn.imm}`;
        }
        break;
      }
      case InsnFormat.LOAD: {
        // LW rd, imm(rs1)
        const rd = expect(TokenType.REGISTER); skipCommas();
        const imm = expect(TokenType.IMMEDIATE);
        expect(TokenType.LPAREN);
        const rs1 = expect(TokenType.REGISTER);
        expect(TokenType.RPAREN);
        if (rd && rs1 && imm) {
          insn.rd = rd.regNum; insn.rs1 = rs1.regNum; insn.imm = imm.value;
          insn.raw = `LW R${insn.rd}, ${insn.imm}(R${insn.rs1})`;
        }
        break;
      }
      case InsnFormat.STORE: {
        // SW rs2, imm(rs1)
        const rs2 = expect(TokenType.REGISTER); skipCommas();
        const imm = expect(TokenType.IMMEDIATE);
        expect(TokenType.LPAREN);
        const rs1 = expect(TokenType.REGISTER);
        expect(TokenType.RPAREN);
        if (rs1 && rs2 && imm) {
          insn.rs2 = rs2.regNum; insn.rs1 = rs1.regNum; insn.imm = imm.value;
          insn.raw = `SW R${insn.rs2}, ${insn.imm}(R${insn.rs1})`;
        }
        break;
      }
      case InsnFormat.BRANCH: {
        const rs1 = expect(TokenType.REGISTER); skipCommas();
        const rs2 = expect(TokenType.REGISTER); skipCommas();
        // label or immediate
        const target = advance();
        if (rs1 && rs2 && target) {
          insn.rs1 = rs1.regNum; insn.rs2 = rs2.regNum;
          if (target.type === TokenType.IMMEDIATE) insn.imm = target.value;
          else if (target.type === TokenType.LABEL_REF) insn.label = target.value;
          insn.raw = `${op.value} R${insn.rs1}, R${insn.rs2}, ${target.value}`;
        }
        break;
      }
      case InsnFormat.JUMP: {
        const rd = expect(TokenType.REGISTER); skipCommas();
        const target = advance();
        if (rd && target) {
          insn.rd = rd.regNum;
          if (target.type === TokenType.IMMEDIATE) insn.imm = target.value;
          else if (target.type === TokenType.LABEL_REF) insn.label = target.value;
          insn.raw = `${op.value} R${insn.rd}, ${target.value}`;
        }
        break;
      }
      case InsnFormat.NOP:
        insn.raw = 'NOP';
        break;
      case InsnFormat.HLT:
        insn.raw = 'HLT';
        break;
    }

    instructions.push(insn);
    skipNewlines();
  }

  return { instructions, parseErrors };
}

/* ── Export DFA transition table for UI display ── */
function getDFATable() {
  const classes = ['alpha','digit','sign','hash','comma','lp','rp','colon','ws','nl','eof','other'];
  const rows = [];
  for (const s of [S.START, S.IDENT, S.REG_R, S.REG_DIG, S.IMM_SIGN, S.IMM_DIG, S.COMMENT, S.WS]) {
    const row = { state: S_NAME[s] };
    for (const cc of classes) {
      row[cc] = S_NAME[DELTA[s][cc]];
    }
    rows.push(row);
  }
  return { classes, rows };
}
