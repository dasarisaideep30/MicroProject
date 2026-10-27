# RISC Pipeline Simulator — Integrated Microproject

**FLAT + COA + DAA** · Dasari Saideep Srinivas · 2411021060596 · Squad 70  
Kalvium × Alliance University · October 2026

---

## What Is This?

A browser-based RISC assembly pipeline simulator that integrates three subjects into one working application:

| Subject | Concept | Role in the Project |
|---------|---------|---------------------|
| **Formal Language and Automata Theory (FLAT)** | DFA, tokenization (Modules 1–2) | Lexes raw assembly text into typed tokens using an explicit DFA transition table |
| **Computer Organization and Architecture (COA)** | Pipelining, hazards, forwarding (Module 3) | Simulates a 5-stage IF→ID→EX→MEM→WB pipeline with data and control hazard detection |
| **Design and Analysis of Algorithms (DAA)** | Greedy algorithms (Module 3) | Greedy forwarding scheduler — always picks the shortest forwarding path, stalls only when necessary |

## How To Run

1. Open `pipeline-sim/index.html` in any modern browser (Chrome recommended)
2. Type RISC assembly or click an example program
3. Click **▶ Simulate Pipeline**
4. Toggle **Enable forwarding** to compare greedy forwarding vs no forwarding

No build step, no server, no dependencies. Just open the HTML file.

## Features

- **DFA Lexer** — Tokenizes assembly with a visible transition table (14 states × 12 character classes)
- **Pipeline Gantt Chart** — Cycle-accurate timeline showing IF, ID, EX, MEM, WB stages
- **Hazard Detection** — Data hazards (RAW), load-use hazards, control hazards (branch flush)
- **Greedy Forwarding** — EX→EX and MEM→EX forwarding paths with per-cycle log
- **Performance Metrics** — CPI, pipeline speedup, stall count, forward count
- **Register File** — Final register state after execution
- **5 Example Programs** — Data hazard, load-use stall, no hazards, branch flush, complex mix

## Supported Instructions

| Type | Instructions |
|------|-------------|
| R-Type | `ADD`, `SUB`, `MUL`, `AND`, `OR`, `XOR`, `SLL`, `SRL` |
| I-Type | `ADDI`, `SUBI`, `ANDI`, `ORI` |
| Memory | `LW`, `SW` |
| Branch | `BEQ`, `BNE`, `BLT`, `BGE` |
| Jump | `JAL`, `JALR` |
| Control | `NOP`, `HLT` |

## Project Structure

```
├── pipeline-sim/              # Working application
│   ├── index.html             # Open this to run
│   ├── css/style.css          # Dark-themed UI
│   └── js/
│       ├── lexer.js           # FLAT: DFA-based lexer + parser
│       ├── pipeline.js        # COA + DAA: pipeline engine + greedy scheduler
│       └── app.js             # UI controller + examples
│
└── report/                    # Project reports (one per subject)
    ├── REPORT-FLAT.html       # DFA lexer report
    ├── REPORT-COA.html        # Pipeline & hazards report
    ├── REPORT-DAA.html        # Greedy forwarding report
    └── alliance-logo.png      # Cover page logo
```

## Reports

Each subject has a separate report (as required for integrated projects) with:
- Cover page, Certificate, Declaration, Acknowledgement
- Table of Contents, Abstract
- Chapter I (Introduction, Problem Statement, Theory)
- Chapter II (System Configuration, Algorithm, Source Code)
- Chapter III (Results with tables and data)
- Chapter IV (Conclusion and References)

---

**Submitted to:** Vaibhav Giri, Simran, Moufiya Technical Mentor  
**Institution:** Kalvium | Alliance University  
**Date:** October 2026
**Deployment Link :- https://dasarisaideepmicroproject.netlify.app/**
