/* ================================================================
 * app.js — UI controller for the pipeline simulator
 * ================================================================ */

/* ── Example programs ── */
const EXAMPLES = [
  {
    name: 'Data hazard + forwarding',
    code: `ADD  R1, R0, R2
ADD  R3, R1, R4
SUB  R5, R3, R1
HLT`,
  },
  {
    name: 'Load-use stall',
    code: `LW   R1, 0(R2)
ADD  R3, R1, R4
SUB  R5, R3, R6
HLT`,
  },
  {
    name: 'No hazards',
    code: `ADD  R1, R2, R3
SUB  R5, R6, R7
AND  R8, R9, R10
OR   R11, R12, R13
HLT`,
  },
  {
    name: 'Branch flush',
    code: `ADDI R1, R0, 5
ADDI R2, R0, 5
BEQ  R1, R2, skip
ADD  R3, R1, R2
skip: SUB R4, R1, R2
HLT`,
  },
  {
    name: 'Complex mix',
    code: `ADDI R1, R0, 10
ADDI R2, R0, 20
ADD  R3, R1, R2
SW   R3, 0(R0)
LW   R4, 0(R0)
SUB  R5, R4, R1
MUL  R6, R5, R2
ADDI R7, R6, 1
HLT`,
  },
];

/* ── DOM references ── */
const $ = id => document.getElementById(id);

const codeArea     = $('code-input');
const buildBtn     = $('build-btn');
const fwdToggle    = $('fwd-toggle');
const exampleChips = $('example-chips');
const tokenOut     = $('token-output');
const dfaTableEl   = $('dfa-table');
const ganttEl      = $('gantt');
const statsEl      = $('stats-output');
const fwdLogEl     = $('fwd-log');
const regFileEl    = $('reg-file');
const errorEl      = $('error-bar');

/* ── Populate examples ── */
EXAMPLES.forEach((ex, i) => {
  const btn = document.createElement('button');
  btn.textContent = ex.name;
  btn.addEventListener('click', () => {
    codeArea.value = ex.code;
    runPipeline();
  });
  exampleChips.appendChild(btn);
});

/* ── DFA transition table (FLAT component display) ── */
function renderDFATable() {
  const { classes, rows } = getDFATable();
  let html = '<thead><tr><th>State</th>';
  for (const c of classes) html += `<th>${c}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += `<tr><td class="st">${row.state}</td>`;
    for (const c of classes) {
      const val = row[c];
      const cls = val === 'ERROR' ? 'err-cell' : (val === row.state ? 'self' : '');
      html += `<td class="${cls}">${val}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  dfaTableEl.innerHTML = html;
}

/* ── Token display ── */
function renderTokens(tokens) {
  let html = '<div class="token-list">';
  for (const t of tokens) {
    if (t.type === 'NEWLINE' || t.type === 'EOF') continue;
    const cls = t.type.toLowerCase().replace('_', '-');
    html += `<span class="tok tok-${cls}" title="${t.type}">${t.value}</span> `;
  }
  html += '</div>';
  tokenOut.innerHTML = html;
}

/* ── Gantt chart ── */
function renderGantt(ganttData, forwardLog) {
  const { rows, maxCycle } = ganttData;
  if (rows.length === 0) {
    ganttEl.innerHTML = '<p>No instructions to display.</p>';
    return;
  }

  const stageColors = {
    'IF': '#60a5fa',   // blue
    'ID': '#34d399',   // green
    'EX': '#fbbf24',   // amber
    'MEM': '#f87171',  // red
    'WB': '#a78bfa',   // purple
    '—':  '#6b7280',   // gray (stall)
    'FLUSH': '#374151',
  };

  let html = '<table class="gantt-table"><thead><tr><th>Instruction</th>';
  for (let c = 0; c < maxCycle; c++) {
    html += `<th>C${c + 1}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of rows) {
    html += `<tr><td class="gantt-insn">${row.insn}</td>`;
    // build stage map
    const stageMap = {};
    for (const s of row.stages) {
      stageMap[s.cycle] = s;
    }

    for (let c = 0; c < maxCycle; c++) {
      const s = stageMap[c];
      if (s) {
        const color = stageColors[s.stage] || '#4b5563';
        const fwd = s.forwarded && s.forwarded.length > 0;
        const border = fwd ? 'border: 2px solid #10b981;' : '';
        const title = fwd ? s.forwarded.map(f => f.label).join(', ') : s.stage;
        const flushed = s.flushed ? 'opacity:0.3;' : '';
        html += `<td class="gantt-cell" style="background:${color};${border}${flushed}" title="${title}">${s.stage}</td>`;
      } else {
        html += `<td class="gantt-cell empty"></td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';

  // legend
  html += '<div class="gantt-legend">';
  for (const [stage, color] of Object.entries(stageColors)) {
    if (stage === 'FLUSH') continue;
    html += `<span><i style="background:${color}"></i>${stage}</span>`;
  }
  html += '<span><i style="border:2px solid #10b981;background:transparent;"></i>Forwarded</span>';
  html += '</div>';

  ganttEl.innerHTML = html;
}

/* ── Stats display ── */
function renderStats(stats) {
  const items = [
    ['Instructions', stats.totalInsns],
    ['Ideal cycles (n+4)', stats.idealCycles],
    ['Actual cycles', stats.actualCycles],
    ['Data hazards', stats.dataHazards],
    ['Control hazards', stats.controlHazards],
    ['Stalls inserted', stats.totalStalls],
    ['Forwards used', stats.forwardCount],
    ['CPI', stats.cpi],
    ['Pipeline speedup vs sequential', `${stats.pipelineSpeedupVsSeq}×`],
    ['Forwarding enabled', stats.forwarding ? 'Yes' : 'No'],
  ];

  let html = '<div class="stats-grid">';
  for (const [k, v] of items) {
    html += `<div class="stat-item"><span class="stat-k">${k}</span><span class="stat-v">${v}</span></div>`;
  }
  html += '</div>';
  statsEl.innerHTML = html;
}

/* ── Forwarding log ── */
function renderForwardLog(log) {
  if (log.length === 0) {
    fwdLogEl.innerHTML = '<p class="dim">No forwarding events.</p>';
    return;
  }
  let html = '<table class="fwd-table"><thead><tr><th>Cycle</th><th>Path</th><th>Register</th><th>Producer</th></tr></thead><tbody>';
  for (const f of log) {
    html += `<tr><td>C${f.cycle + 1}</td><td>${f.from}→${f.to}</td><td>R${f.reg}</td><td>${f.producer}</td></tr>`;
  }
  html += '</tbody></table>';
  fwdLogEl.innerHTML = html;
}

/* ── Register file display ── */
function renderRegs(regs) {
  let html = '<div class="reg-grid">';
  for (let i = 0; i < 32; i++) {
    const val = regs[i] || 0;
    const active = val !== 0 ? ' reg-active' : '';
    html += `<div class="reg-cell${active}"><span class="reg-name">R${i}</span><span class="reg-val">${val}</span></div>`;
  }
  html += '</div>';
  regFileEl.innerHTML = html;
}

/* ── Main pipeline run ── */
function runPipeline() {
  errorEl.textContent = '';
  errorEl.style.display = 'none';

  const source = codeArea.value.trim();
  if (!source) return;

  // Step 1: tokenize (FLAT: DFA)
  const { tokens, errors: lexErrors } = tokenize(source);
  renderTokens(tokens);

  if (lexErrors.length > 0) {
    errorEl.textContent = lexErrors.map(e => `Line ${e.line + 1}: ${e.msg}`).join(' | ');
    errorEl.style.display = 'block';
  }

  // Step 2: parse
  const { instructions, parseErrors } = parse(tokens);
  if (parseErrors.length > 0) {
    errorEl.textContent += (errorEl.textContent ? ' | ' : '') + parseErrors.map(e => `Line ${e.line + 1}: ${e.msg}`).join(' | ');
    errorEl.style.display = 'block';
  }

  if (instructions.filter(i => i.format !== 'LABEL').length === 0) {
    errorEl.textContent = 'No executable instructions found.';
    errorEl.style.display = 'block';
    return;
  }

  // Step 3: simulate pipeline (COA + DAA)
  const forwarding = fwdToggle.checked;
  const result = simulatePipeline(instructions, { forwarding });

  // Step 4: render results
  const ganttData = buildGantt(result.timeline, result.code);
  renderGantt(ganttData, result.forwardLog);
  renderStats(result.stats);
  renderForwardLog(result.forwardLog);
  renderRegs(result.regs);
}

/* ── Event listeners ── */
buildBtn.addEventListener('click', runPipeline);
fwdToggle.addEventListener('change', runPipeline);
codeArea.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); runPipeline(); }
});

/* ── Initial render ── */
renderDFATable();
codeArea.value = EXAMPLES[0].code;
runPipeline();
