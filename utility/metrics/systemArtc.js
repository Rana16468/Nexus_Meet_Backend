const systemArtc = () => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nexus Meet — Telemetry & Diagnostics</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0d13;
            --grid-line: rgba(255,255,255,0.025);
            --surface: #12161f;
            --surface-raised: #161c27;
            --surface-tinted: #0e1219;
            --accent: #4ee1a0;
            --accent-glow: rgba(78, 225, 160, 0.35);
            --accent-dim: rgba(78, 225, 160, 0.12);
            --signal-blue: #5b9dff;
            --signal-blue-dim: rgba(91, 157, 255, 0.12);
            --success: #4ee1a0;
            --success-bg: rgba(78, 225, 160, 0.1);
            --success-dark: #4ee1a0;
            --danger: #ff5c66;
            --danger-bg: rgba(255, 92, 102, 0.1);
            --warn: #ffb454;
            --warn-bg: rgba(255, 180, 84, 0.1);
            --text-primary: #eef1f6;
            --text-secondary: #8993a8;
            --text-tertiary: #4d5567;
            --border: rgba(255, 255, 255, 0.07);
            --border-strong: rgba(255, 255, 255, 0.14);
            --shadow-panel: 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35);
            --shadow-panel-hover: 0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 32px rgba(0,0,0,0.45);
            --radius: 10px;
            --radius-sm: 6px;
            --radius-pill: 100px;
            --mono: 'IBM Plex Mono', monospace;
            --display: 'Space Grotesk', sans-serif;
            --body-font: 'Plus Jakarta Sans', sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            background:
                repeating-linear-gradient(0deg, var(--grid-line) 0px, var(--grid-line) 1px, transparent 1px, transparent 32px),
                repeating-linear-gradient(90deg, var(--grid-line) 0px, var(--grid-line) 1px, transparent 1px, transparent 32px),
                var(--bg);
            color: var(--text-primary);
            font-family: var(--body-font);
            min-height: 100vh;
            padding: 0;
        }

        /* ── Rivet decoration for panels ── */
        .panel-rivets::before,
        .panel-rivets::after {
            content: '';
            position: absolute;
            width: 4px; height: 4px;
            border-radius: 50%;
            background: var(--border-strong);
            box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset;
        }
        .panel-rivets::before { top: 9px; left: 9px; }
        .panel-rivets::after  { top: 9px; right: 9px; }

        /* ── Top Nav Bar ── */
        .topbar {
            background: var(--surface);
            border-bottom: 1px solid var(--border);
            padding: 0 2.5rem;
            height: 58px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .topbar-left {
            display: flex;
            align-items: center;
            gap: 0.85rem;
        }

        .logo-mark {
            width: 30px;
            height: 30px;
            background: var(--surface-tinted);
            border: 1px solid var(--border-strong);
            border-radius: 7px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .logo-mark svg { color: var(--accent); }

        .brand-name {
            font-family: var(--display);
            font-weight: 700;
            font-size: 0.95rem;
            color: var(--text-primary);
            letter-spacing: -0.01em;
        }

        .brand-divider {
            width: 1px;
            height: 16px;
            background: var(--border-strong);
        }

        .brand-section {
            font-family: var(--mono);
            font-size: 0.72rem;
            color: var(--text-tertiary);
            font-weight: 500;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .topbar-right {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .live-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: var(--surface-tinted);
            border: 1px solid var(--border-strong);
            padding: 0.35rem 0.8rem 0.35rem 0.65rem;
            border-radius: var(--radius-pill);
        }

        .live-dot {
            width: 7px; height: 7px;
            background: var(--danger);
            border-radius: 50%;
            box-shadow: 0 0 8px 1px rgba(255, 92, 102, 0.6);
            animation: livepulse 1.6s infinite;
        }

        .live-text {
            font-family: var(--mono);
            font-size: 0.7rem;
            font-weight: 600;
            color: var(--text-secondary);
            letter-spacing: 0.1em;
            text-transform: uppercase;
        }

        /* ── Page Layout ── */
        .page {
            max-width: 1280px;
            margin: 0 auto;
            padding: 2.25rem 2.5rem 4rem;
        }

        /* ── Page Header ── */
        .page-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            margin-bottom: 1.75rem;
            padding-bottom: 1.25rem;
            border-bottom: 1px solid var(--border);
        }

        .page-eyebrow {
            font-family: var(--mono);
            font-size: 0.7rem;
            font-weight: 600;
            color: var(--accent);
            letter-spacing: 0.14em;
            text-transform: uppercase;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .page-eyebrow::before {
            content: '';
            width: 14px; height: 1px;
            background: var(--accent);
        }

        .page-title {
            font-family: var(--display);
            font-size: 1.7rem;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.02em;
            margin-bottom: 0.35rem;
        }

        .page-subtitle {
            font-size: 0.85rem;
            color: var(--text-secondary);
        }

        .refresh-tag {
            font-family: var(--mono);
            font-size: 0.72rem;
            color: var(--text-tertiary);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            letter-spacing: 0.03em;
        }

        .refresh-tag::before {
            content: '';
            width: 9px; height: 9px;
            border: 1.5px solid var(--text-tertiary);
            border-top-color: var(--signal-blue);
            border-radius: 50%;
            display: inline-block;
            animation: spin 1.3s linear infinite;
        }

        /* ── Stat row (top KPIs) ── */
        .stat-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
            margin-bottom: 1.25rem;
        }

        .stat-card {
            position: relative;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 1.25rem 1.4rem;
            box-shadow: var(--shadow-panel);
            transition: box-shadow 0.2s, border-color 0.2s, transform 0.2s;
        }

        .stat-card:hover {
            box-shadow: var(--shadow-panel-hover);
            border-color: var(--border-strong);
            transform: translateY(-2px);
        }

        .stat-top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.9rem;
        }

        .stat-icon-wrap {
            width: 32px; height: 32px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border-strong);
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--surface-tinted);
        }

        .stat-icon-wrap.blue  { color: var(--signal-blue); }
        .stat-icon-wrap.green { color: var(--success); }
        .stat-icon-wrap.red   { color: var(--danger); }
        .stat-icon-wrap.amber { color: var(--warn); }

        .stat-led {
            width: 6px; height: 6px;
            border-radius: 50%;
        }
        .stat-led.blue  { background: var(--signal-blue); box-shadow: 0 0 6px 1px var(--signal-blue-dim); }
        .stat-led.green { background: var(--success); box-shadow: 0 0 6px 1px var(--accent-glow); }
        .stat-led.red   { background: var(--danger); box-shadow: 0 0 6px 1px rgba(255,92,102,0.4); }
        .stat-led.amber { background: var(--warn); box-shadow: 0 0 6px 1px rgba(255,180,84,0.4); }

        .stat-label {
            font-family: var(--mono);
            font-size: 0.68rem;
            font-weight: 600;
            color: var(--text-tertiary);
            letter-spacing: 0.09em;
            text-transform: uppercase;
            margin-bottom: 0.4rem;
        }

        .stat-value {
            font-family: var(--mono);
            font-size: 1.6rem;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.01em;
            line-height: 1;
        }

        .stat-meta {
            font-family: var(--mono);
            font-size: 0.74rem;
            color: var(--text-tertiary);
            margin-top: 0.4rem;
        }

        /* ── Progress bar ── */
        .prog-track {
            width: 100%;
            height: 3px;
            background: var(--surface-tinted);
            border: 1px solid var(--border);
            border-radius: 2px;
            margin-top: 0.9rem;
            overflow: hidden;
        }

        .prog-fill {
            height: 100%;
            background: var(--signal-blue);
            box-shadow: 0 0 6px var(--signal-blue-dim);
            width: 0%;
            transition: width 0.9s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* ── Main grid ── */
        .main-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 1.25rem;
        }

        /* ── Card ── */
        .card {
            position: relative;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 1.4rem 1.5rem;
            box-shadow: var(--shadow-panel);
            transition: box-shadow 0.2s, border-color 0.2s, transform 0.2s;
        }

        .card:hover {
            box-shadow: var(--shadow-panel-hover);
            border-color: var(--border-strong);
            transform: translateY(-2px);
        }

        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.15rem;
        }

        .card-title {
            font-family: var(--mono);
            font-size: 0.7rem;
            font-weight: 600;
            letter-spacing: 0.09em;
            text-transform: uppercase;
            color: var(--text-tertiary);
        }

        .card-icon {
            width: 30px; height: 30px;
            background: var(--surface-tinted);
            border: 1px solid var(--border-strong);
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
        }

        /* ── Row list ── */
        .row-list { display: flex; flex-direction: column; gap: 0; }

        .row-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.7rem 0;
            border-bottom: 1px dashed var(--border);
            font-size: 0.85rem;
        }

        .row-item:last-child { border-bottom: none; padding-bottom: 0; }
        .row-item:first-child { padding-top: 0; }

        .row-label { color: var(--text-secondary); }

        .row-val {
            font-family: var(--mono);
            font-weight: 600;
            color: var(--text-primary);
            font-size: 0.9rem;
        }

        .row-val.accent { color: var(--signal-blue); }
        .row-val.success { color: var(--success); }

        /* ── Health matrix (full width) ── */
        .full-width { grid-column: 1 / -1; }

        .health-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-top: 0.25rem;
        }

        .health-cell {
            position: relative;
            background: var(--surface-tinted);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 1.4rem 1.25rem;
            text-align: center;
            overflow: hidden;
        }

        .health-cell::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 2px;
            background: currentColor;
            opacity: 0.5;
        }

        .health-cell-label {
            font-family: var(--mono);
            font-size: 0.68rem;
            font-weight: 600;
            letter-spacing: 0.09em;
            text-transform: uppercase;
            color: var(--text-tertiary);
            margin-bottom: 0.6rem;
        }

        .health-cell-val {
            font-family: var(--mono);
            font-size: 1.9rem;
            font-weight: 600;
            letter-spacing: -0.02em;
            line-height: 1;
        }

        .health-cell-val.accent  { color: var(--signal-blue); }
        .health-cell-val.success { color: var(--success); }
        .health-cell-val.danger  { color: var(--danger); }
        .health-cell.accent  { color: var(--signal-blue); }
        .health-cell.success { color: var(--success); }
        .health-cell.danger  { color: var(--danger); }

        /* ── Accent card (CPU) ── */
        .card-accent {
            background:
                radial-gradient(circle at 85% -10%, rgba(78,225,160,0.16), transparent 55%),
                var(--surface-raised);
            border: 1px solid var(--border-strong);
        }

        .card-accent .card-title { color: var(--accent); opacity: 0.85; }
        .card-accent .card-icon { background: var(--accent-dim); border-color: rgba(78,225,160,0.3); color: var(--accent); }

        .cpu-readout {
            display: flex;
            align-items: baseline;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
        }

        .cpu-readout .stat-value {
            font-size: 2.9rem;
            font-weight: 700;
            color: var(--text-primary);
        }

        .cpu-unit {
            font-family: var(--mono);
            font-size: 0.85rem;
            color: var(--text-tertiary);
        }

        .card-accent .stat-meta {
            font-family: var(--mono);
            font-size: 0.78rem;
            color: var(--text-secondary);
        }

        /* ── Footer ── */
        footer {
            text-align: center;
            margin-top: 3rem;
            font-family: var(--mono);
            font-size: 0.7rem;
            color: var(--text-tertiary);
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        /* ── Animations ── */
        @keyframes livepulse {
            0%   { opacity: 1;   transform: scale(1);    }
            50%  { opacity: 0.4; transform: scale(1.3);  }
            100% { opacity: 1;   transform: scale(1);    }
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
            .live-dot, .refresh-tag::before { animation: none; }
        }

        @media (max-width: 900px) {
            .main-grid { grid-template-columns: 1fr 1fr; }
            .full-width { grid-column: 1 / -1; }
            .page { padding: 1.5rem 1.25rem 3rem; }
        }

        @media (max-width: 600px) {
            .main-grid { grid-template-columns: 1fr; }
            .topbar { padding: 0 1.25rem; }
            .page-header { flex-direction: column; align-items: flex-start; gap: 0.5rem; }
            .health-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>

    <!-- Nav Bar -->
    <nav class="topbar">
        <div class="topbar-left">
            <div class="logo-mark">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 10l5-3v10l-5-3M4 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
                </svg>
            </div>
            <span class="brand-name">Nexus Meet</span>
            <div class="brand-divider"></div>
            <span class="brand-section">SFU // TELEMETRY</span>
        </div>
        <div class="topbar-right">
            <div class="live-badge">
                <div class="live-dot"></div>
                <span class="live-text">Rec · Live</span>
            </div>
        </div>
    </nav>

    <!-- Page -->
    <div class="page">

        <div class="page-header">
            <div>
                <div class="page-eyebrow">Diagnostics Console</div>
                <div class="page-title">Real-Time System Readout</div>
                <div class="page-subtitle">Self-hosted mediasoup SFU · localhost:4000 — auto-refreshing every 3 seconds</div>
            </div>
            <div class="refresh-tag">Syncing metrics</div>
        </div>

        <!-- Top KPI row -->
        <div class="stat-row">

            <div class="stat-card panel-rivets">
                <div class="stat-top-row">
                    <div class="stat-icon-wrap blue">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"></rect><rect x="2" y="14" width="20" height="8" rx="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                    </div>
                    <div class="stat-led blue"></div>
                </div>
                <div class="stat-label">RAM Used</div>
                <div class="stat-value" id="ram-val">—</div>
                <div class="stat-meta" id="ram-sub">Loading…</div>
                <div class="prog-track"><div class="prog-fill" id="ram-bar"></div></div>
            </div>

            <div class="stat-card panel-rivets">
                <div class="stat-top-row">
                    <div class="stat-icon-wrap amber">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>
                    </div>
                    <div class="stat-led amber"></div>
                </div>
                <div class="stat-label">Disk Used</div>
                <div class="stat-value" id="storage-val">—</div>
                <div class="stat-meta" id="storage-sub">Loading…</div>
                <div class="prog-track"><div class="prog-fill" id="storage-bar" style="background: var(--warn); box-shadow: 0 0 6px var(--warn-bg);"></div></div>
            </div>

            <div class="stat-card panel-rivets">
                <div class="stat-top-row">
                    <div class="stat-icon-wrap green">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <div class="stat-led green"></div>
                </div>
                <div class="stat-label">Total Users</div>
                <div class="stat-value" id="users-total">—</div>
                <div class="stat-meta" id="users-active-meta">— verified active</div>
            </div>

            <div class="stat-card panel-rivets">
                <div class="stat-top-row">
                    <div class="stat-icon-wrap red">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                    </div>
                    <div class="stat-led red"></div>
                </div>
                <div class="stat-label">Requests / min</div>
                <div class="stat-value" id="hits-min">—</div>
                <div class="stat-meta" id="hits-hour-meta">— total this hour</div>
            </div>

        </div>

        <!-- Main grid -->
        <div class="main-grid">

            <!-- CPU — accent card -->
            <div class="card card-accent panel-rivets">
                <div class="card-header">
                    <div class="card-title">Processor Load</div>
                    <div class="card-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="15" x2="23" y2="15"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="15" x2="4" y2="15"></line></svg>
                    </div>
                </div>
                <div class="cpu-readout">
                    <div class="stat-value" id="cpu-val">—</div>
                    <span class="cpu-unit">load avg / 1m</span>
                </div>
                <div class="stat-meta" id="cpu-sub">Loading…</div>
            </div>

            <!-- Server Specs -->
            <div class="card panel-rivets">
                <div class="card-header">
                    <div class="card-title">Server Specs</div>
                    <div class="card-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="22" y2="7"></line><line x1="2" y1="17" x2="22" y2="17"></line></svg>
                    </div>
                </div>
                <div class="row-list">
                    <div class="row-item">
                        <span class="row-label">OS Platform</span>
                        <span class="row-val" id="os-platform">—</span>
                    </div>
                    <div class="row-item">
                        <span class="row-label">Uptime</span>
                        <span class="row-val accent" id="uptime">—</span>
                    </div>
                </div>
            </div>

            <!-- Users -->
            <div class="card panel-rivets">
                <div class="card-header">
                    <div class="card-title">User Accounts</div>
                    <div class="card-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                </div>
                <div class="row-list">
                    <div class="row-item">
                        <span class="row-label">Registered</span>
                        <span class="row-val" id="users-total-card">—</span>
                    </div>
                    <div class="row-item">
                        <span class="row-label">Verified Active</span>
                        <span class="row-val success" id="users-active">—</span>
                    </div>
                </div>
            </div>

            <!-- API Traffic -->
            <div class="card panel-rivets">
                <div class="card-header">
                    <div class="card-title">API Traffic</div>
                    <div class="card-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                    </div>
                </div>
                <div class="row-list">
                    <div class="row-item">
                        <span class="row-label">Hits / Minute</span>
                        <span class="row-val accent" id="hits-min-card">—</span>
                    </div>
                    <div class="row-item">
                        <span class="row-label">Hits / Hour</span>
                        <span class="row-val accent" id="hits-hour">—</span>
                    </div>
                </div>
            </div>

            <!-- Health Matrix -->
            <div class="card full-width panel-rivets">
                <div class="card-header">
                    <div class="card-title">API Health Matrix</div>
                    <div class="card-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    </div>
                </div>
                <div class="health-grid">
                    <div class="health-cell accent">
                        <div class="health-cell-label">Avg Latency</div>
                        <div class="health-cell-val accent" id="health-latency">— ms</div>
                    </div>
                    <div class="health-cell success">
                        <div class="health-cell-label">Success Rate</div>
                        <div class="health-cell-val success" id="health-success">—%</div>
                    </div>
                    <div class="health-cell danger">
                        <div class="health-cell-label">Error Count</div>
                        <div class="health-cell-val danger" id="health-errors">—</div>
                    </div>
                </div>
            </div>

        </div>

        <footer>Nexus Meet &mdash; Telemetry &amp; Diagnostics Dashboard</footer>
    </div>

    <script>
        async function fetchMetrics() {
            try {
                const res = await fetch('/api/v1/monitor/metrics');
                if (!res.ok) return;
                const d = await res.json();

                document.getElementById('ram-val').innerText        = d.ram.usedGB + ' GB';
                document.getElementById('ram-sub').innerText        = d.ram.usedGB + ' of ' + d.ram.totalGB + ' GB';
                document.getElementById('ram-bar').style.width      = d.ram.percent + '%';

                document.getElementById('storage-val').innerText    = d.storage.usedGB + ' GB';
                document.getElementById('storage-sub').innerText    = d.storage.usedGB + ' of ' + d.storage.totalGB + ' GB';
                document.getElementById('storage-bar').style.width  = d.storage.percent + '%';

                document.getElementById('users-total').innerText    = d.users.total;
                document.getElementById('users-active-meta').innerText = d.users.active + ' verified active';
                document.getElementById('users-total-card').innerText  = d.users.total;
                document.getElementById('users-active').innerText   = d.users.active;

                document.getElementById('hits-min').innerText       = d.traffic.hitsMin;
                document.getElementById('hits-hour-meta').innerText = d.traffic.hitsHour + ' total this hour';
                document.getElementById('hits-min-card').innerText  = d.traffic.hitsMin;
                document.getElementById('hits-hour').innerText      = d.traffic.hitsHour;

                document.getElementById('cpu-val').innerText        = d.cpu.load1m.toFixed(2);
                document.getElementById('cpu-sub').innerText        = d.cpu.model;

                document.getElementById('os-platform').innerText    = d.osPlatform;
                document.getElementById('uptime').innerText         = d.uptimeHours + ' hrs';

                document.getElementById('health-latency').innerText = d.health.avgLatencyMs + ' ms';
                document.getElementById('health-success').innerText = d.health.successRatePercent + '%';
                document.getElementById('health-errors').innerText  = d.health.errorCount;

            } catch (err) {
                console.error('Failed to fetch diagnostics:', err);
            }
        }

        fetchMetrics();
        setInterval(fetchMetrics, 3000);
    </script>
</body>
</html>`;
};

export default systemArtc;
