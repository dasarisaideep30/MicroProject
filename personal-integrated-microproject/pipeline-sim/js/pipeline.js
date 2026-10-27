/* ================================================================
 * pipeline.js — 5-stage RISC pipeline simulator
 * COA component (Module 3): Pipelining, hazards, forwarding
 * DAA component (Module 3): Greedy hazard resolution
 * ================================================================
 *
 * Pipeline stages: IF → ID → EX → MEM → WB
 *
 * Hazard handling:
 *   • Data hazards   → greedy forwarding (EX→EX, MEM→EX) or stall
 *   • Load-use hazard → 1-cycle stall then forward
 *   • Control hazards → 1-cycle stall after branch (static predict-not-taken)
 *   • Structural      → single memory port, handled by stall
 *
 * The greedy scheduling strategy is from DAA Module 3:
 *   "Always forward if the value is ready; only stall when forwarding
 *    is impossible."  This is a locally optimal (greedy) choice that
 *    also happens to be globally optimal for in-order single-issue.
 * ================================================================ */

const PipeStage = Object.freeze({
  IF: 'IF', ID: 'ID', EX: 'EX', MEM: 'MEM', WB: 'WB',
  STALL: '—', EMPTY: '',
});

/* ── Register file ── */
function makeRegFile() {
  const r = new Int32Array(32);
  return r; // R0 is always 0
}

/* ── Pipeline entry (one instruction in the pipe) ── */
function makeSlot(insn, pc) {
  return {
    insn,           // parsed instruction
    pc,             // program counter
    stage: PipeStage.IF,
    aluResult: 0,
    memData: 0,
    stalled: false,
    flushed: false,
    forwarded: [],  // list of forwarding paths used
  };
}

/* ── Detect which registers an instruction reads ── */
function srcRegs(insn) {
  if (!insn) return [];
  switch (insn.format) {
    case 'R_TYPE':  return [insn.rs1, insn.rs2];
    case 'I_TYPE':  return [insn.rs1];
    case 'LOAD':    return [insn.rs1];
    case 'STORE':   return [insn.rs1, insn.rs2];
    case 'BRANCH':  return [insn.rs1, insn.rs2];
    case 'JUMP':    return insn.op === 'JALR' ? [insn.rs1] : [];
    default:        return [];
  }
}

/* ── Detect which register an instruction writes ── */
function dstReg(insn) {
  if (!insn) return -1;
  switch (insn.format) {
    case 'R_TYPE': case 'I_TYPE': case 'LOAD': case 'JUMP':
      return insn.rd !== undefined ? insn.rd : -1;
    default: return -1;
  }
}

/* ── Greedy forwarding check (DAA greedy algorithm) ──
 * For each source register of the instruction in ID:
 *   1. Can we forward from EX stage? (EX→EX forwarding, value ready)
 *   2. Can we forward from MEM stage? (MEM→EX forwarding, value ready)
 *   3. Is it a load-use? → must stall 1 cycle (cannot forward from EX
 *      because the load value is only available after MEM)
 *   4. If none needed → no hazard
 *
 * Greedy choice: always pick the shortest forwarding path available.
 * This is optimal for in-order issue because no reordering is possible.
 */
function checkHazards(idSlot, exSlot, memSlot) {
  const result = { stall: false, forwards: [], reason: '' };
  if (!idSlot || !idSlot.insn) return result;

  const srcs = srcRegs(idSlot.insn).filter(r => r !== undefined && r !== 0);

  for (const src of srcs) {
    // check EX stage
    if (exSlot && exSlot.insn && !exSlot.flushed) {
      const exDst = dstReg(exSlot.insn);
      if (exDst === src && exDst !== 0) {
        if (exSlot.insn.format === 'LOAD') {
          // load-use hazard: data not available until MEM completes
          result.stall = true;
          result.reason = `Load-use hazard: R${src} written by ${exSlot.insn.op} (not ready until MEM)`;
          return result;
        }
        // EX→EX forwarding (greedy: forward immediately)
        result.forwards.push({
          from: 'EX', to: 'ID', reg: src,
          producer: exSlot.insn.raw,
          label: `EX→EX fwd R${src}`
        });
        continue;
      }
    }
    // check MEM stage
    if (memSlot && memSlot.insn && !memSlot.flushed) {
      const memDst = dstReg(memSlot.insn);
      if (memDst === src && memDst !== 0) {
        // MEM→EX forwarding
        result.forwards.push({
          from: 'MEM', to: 'ID', reg: src,
          producer: memSlot.insn.raw,
          label: `MEM→EX fwd R${src}`
        });
      }
    }
  }
  return result;
}

/* ── ALU execution ── */
function executeALU(insn, regs) {
  const a = regs[insn.rs1] || 0;
  const b = (insn.rs2 !== undefined) ? (regs[insn.rs2] || 0) : (insn.imm || 0);

  switch (insn.op) {
    case 'ADD': case 'ADDI': return a + b;
    case 'SUB': case 'SUBI': return a - b;
    case 'MUL': return a * b;
    case 'AND': case 'ANDI': return a & b;
    case 'OR':  case 'ORI':  return a | b;
    case 'XOR': return a ^ b;
    case 'SLL': return a << (b & 31);
    case 'SRL': return a >>> (b & 31);
    default: return 0;
  }
}

/* ── Branch evaluation ── */
function evalBranch(insn, regs) {
  const a = regs[insn.rs1] || 0;
  const b = regs[insn.rs2] || 0;
  switch (insn.op) {
    case 'BEQ': return a === b;
    case 'BNE': return a !== b;
    case 'BLT': return a < b;
    case 'BGE': return a >= b;
    default: return false;
  }
}

/* ================================================================
 * Full pipeline simulation
 * Returns a timeline (cycle × instruction grid) and statistics
 * ================================================================ */
function simulatePipeline(instructions, opts = {}) {
  const enableForwarding = opts.forwarding !== false;
  const maxCycles = opts.maxCycles || 200;

  // filter out labels, keep only executable instructions
  const labels = {};
  const code = [];
  for (const insn of instructions) {
    if (insn.format === 'LABEL') {
      labels[insn.label] = code.length;
    } else {
      code.push(insn);
    }
  }

  // resolve branch labels
  for (const insn of code) {
    if (insn.label !== undefined && labels[insn.label] !== undefined) {
      insn.target = labels[insn.label];
    }
  }

  if (code.length === 0) return { timeline: [], stats: {}, code };

  const regs = makeRegFile();
  const mem  = new Int32Array(256); // small data memory

  // pipeline registers
  let pipe = [null, null, null, null, null]; // IF, ID, EX, MEM, WB

  // timeline: array of cycle snapshots
  const timeline = [];
  // each row in timeline is { cycle, slots: [{insn, stage}...] }

  let pc = 0;
  let cycle = 0;
  let halted = false;
  let stallNextCycle = false;

  // instruction ↔ row mapping for the Gantt chart
  const insnRows = new Map(); // insn index → row id
  let nextRow = 0;

  // stats
  let totalStalls = 0;
  let dataHazards = 0;
  let controlHazards = 0;
  let forwardCount = 0;
  const forwardLog = [];

  while (cycle < maxCycles && !halted) {
    const snap = { cycle, events: [] };

    // ── WB ──
    if (pipe[4]) {
      const s = pipe[4];
      if (!s.flushed && s.insn) {
        const dst = dstReg(s.insn);
        if (dst > 0) {
          if (s.insn.format === 'LOAD') {
            regs[dst] = s.memData;
          } else {
            regs[dst] = s.aluResult;
          }
        }
        regs[0] = 0; // R0 hardwired to 0
      }
    }

    // ── MEM ──
    if (pipe[3] && !pipe[3].flushed && pipe[3].insn) {
      const s = pipe[3];
      if (s.insn.format === 'LOAD') {
        const addr = (s.aluResult >> 2) & 0xFF;
        s.memData = mem[addr] || 0;
      } else if (s.insn.format === 'STORE') {
        const addr = (s.aluResult >> 2) & 0xFF;
        mem[addr] = regs[s.insn.rs2] || 0;
      }
    }

    // ── EX ──
    if (pipe[2] && !pipe[2].flushed && pipe[2].insn) {
      const s = pipe[2];
      const insn = s.insn;
      if (insn.format === 'R_TYPE' || insn.format === 'I_TYPE') {
        s.aluResult = executeALU(insn, regs);
      } else if (insn.format === 'LOAD' || insn.format === 'STORE') {
        s.aluResult = (regs[insn.rs1] || 0) + (insn.imm || 0);
      } else if (insn.format === 'BRANCH') {
        const taken = evalBranch(insn, regs);
        if (taken) {
          // flush IF and ID
          if (pipe[0]) pipe[0].flushed = true;
          if (pipe[1]) pipe[1].flushed = true;
          if (insn.target !== undefined) pc = insn.target;
          else pc = s.pc + (insn.imm || 1);
          controlHazards++;
          snap.events.push(`Branch taken → PC=${pc}`);
        }
      } else if (insn.format === 'JUMP') {
        if (pipe[0]) pipe[0].flushed = true;
        if (pipe[1]) pipe[1].flushed = true;
        s.aluResult = (s.pc + 1); // return address (simplified)
        if (insn.target !== undefined) pc = insn.target;
        else if (insn.op === 'JALR') pc = (regs[insn.rs1] || 0) + (insn.imm || 0);
        else pc = s.pc + (insn.imm || 1);
        controlHazards++;
      } else if (insn.op === 'HLT') {
        halted = true;
      }
    }

    // ── ID: hazard check ──
    let stallThisCycle = false;
    if (pipe[1] && !pipe[1].flushed && pipe[1].insn) {
      if (enableForwarding) {
        const hz = checkHazards(pipe[1], pipe[2], pipe[3]);
        if (hz.stall) {
          stallThisCycle = true;
          dataHazards++;
          totalStalls++;
          snap.events.push(`STALL: ${hz.reason}`);
        }
        for (const fw of hz.forwards) {
          forwardCount++;
          forwardLog.push({ cycle, ...fw });
          snap.events.push(`FWD: ${fw.label}`);
          pipe[1].forwarded.push(fw);
        }
      } else {
        // no forwarding: stall for every RAW hazard
        const srcs = srcRegs(pipe[1].insn).filter(r => r !== undefined && r !== 0);
        for (const src of srcs) {
          if (pipe[2] && !pipe[2].flushed && dstReg(pipe[2].insn) === src) {
            stallThisCycle = true; dataHazards++; totalStalls++;
            snap.events.push(`STALL: RAW on R${src} (no forwarding)`);
          }
          if (pipe[3] && !pipe[3].flushed && dstReg(pipe[3].insn) === src) {
            stallThisCycle = true; dataHazards++; totalStalls++;
            snap.events.push(`STALL: RAW on R${src} (no forwarding)`);
          }
        }
      }
    }

    // ── advance pipeline ──
    if (stallThisCycle) {
      // bubble: EX gets NOP, ID and IF stay
      pipe[4] = pipe[3];
      pipe[3] = pipe[2];
      pipe[2] = { insn: null, pc: -1, stage: PipeStage.EX, stalled: true, flushed: false, forwarded: [] }; // bubble
      // pipe[1] and pipe[0] stay
    } else {
      pipe[4] = pipe[3];
      pipe[3] = pipe[2];
      pipe[2] = pipe[1];
      pipe[1] = pipe[0];

      // ── IF ──
      if (!halted && pc < code.length) {
        pipe[0] = makeSlot(code[pc], pc);
        if (!insnRows.has(pc + '_' + cycle)) {
          insnRows.set(pc + '_' + cycle, nextRow++);
        }
        pipe[0]._row = insnRows.get(pc + '_' + cycle) ?? nextRow++;
        pc++;
      } else {
        pipe[0] = null;
      }
    }

    // record timeline snapshot
    const stageLabels = [PipeStage.IF, PipeStage.ID, PipeStage.EX, PipeStage.MEM, PipeStage.WB];
    for (let s = 0; s < 5; s++) {
      if (pipe[s] && pipe[s].insn && !pipe[s].flushed) {
        pipe[s].stage = stageLabels[s];
      }
    }

    snap.pipe = pipe.map(s => s ? {
      insn: s.insn ? s.insn.raw : (s.stalled ? 'BUBBLE' : ''),
      stage: s.flushed ? 'FLUSH' : (s.stalled ? PipeStage.STALL : s.stage),
      pc: s.pc,
      forwarded: s.forwarded || [],
      flushed: s.flushed,
    } : null);

    timeline.push(snap);
    cycle++;

    // drain: stop when all slots empty
    if (halted && !pipe[0] && !pipe[1] && !pipe[2] && !pipe[3] && !pipe[4]) break;
    if (!halted && pc >= code.length && !pipe[0] && !pipe[1] && !pipe[2] && !pipe[3] && !pipe[4]) break;
  }

  // ── statistics ──
  const totalInsns = code.filter(c => c.format !== 'LABEL').length;
  const idealCycles = totalInsns + 4; // n + (stages - 1)
  const actualCycles = cycle;
  const cpi = totalInsns > 0 ? (actualCycles / totalInsns) : 0;
  const speedup = idealCycles > 0 ? (idealCycles / actualCycles) : 0;
  const pipelineSpeedup = totalInsns > 0 ? ((totalInsns * 5) / actualCycles) : 0; // vs sequential

  const stats = {
    totalInsns,
    idealCycles,
    actualCycles,
    totalStalls,
    dataHazards,
    controlHazards,
    forwardCount,
    cpi: cpi.toFixed(2),
    speedupOverIdeal: speedup.toFixed(2),
    pipelineSpeedupVsSeq: pipelineSpeedup.toFixed(2),
    forwarding: enableForwarding,
  };

  return { timeline, stats, code, forwardLog, regs: Array.from(regs) };
}

/* ── Build Gantt-style timeline matrix ── */
function buildGantt(timeline, code) {
  if (code.length === 0) return { rows: [], maxCycle: 0 };

  // each instruction gets a row; columns are cycles
  // we track when each instruction entered IF
  const rows = [];
  const insnEntries = new Map(); // pc → {row, entries}

  for (let c = 0; c < timeline.length; c++) {
    const snap = timeline[c];
    for (let s = 0; s < 5; s++) {
      const p = snap.pipe[s];
      if (!p || p.pc < 0 || p.pc === undefined) continue;

      const key = p.pc;
      if (!insnEntries.has(key)) {
        insnEntries.set(key, {
          insn: p.insn,
          pc: p.pc,
          stages: [],
        });
      }
      const entry = insnEntries.get(key);
      entry.stages.push({ cycle: c, stage: p.stage, forwarded: p.forwarded, flushed: p.flushed });
    }
  }

  // sort by pc
  const sorted = [...insnEntries.entries()].sort((a, b) => a[0] - b[0]);
  const ganttRows = sorted.map(([pc, data]) => ({
    insn: data.insn || `I${pc}`,
    pc,
    stages: data.stages,
  }));

  return { rows: ganttRows, maxCycle: timeline.length };
}
