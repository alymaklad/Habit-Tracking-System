// Generates the Adaptive Habit League screen artboards (.dc.html) for the design canvas.
// Shared chrome lives here so all screens stay pixel-identical; content is emitted literally
// so the only template hole in the output is {{themeVars}}.
import { writeFileSync as write } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve output next to this script, not to the shell's working directory — running it
// from the project root would otherwise scatter the artboards there.
const OUT_DIR = dirname(fileURLToPath(import.meta.url))
const writeFileSync = (name, contents) => write(join(OUT_DIR, name), contents);

const W = 1180, H = 820;

const ICON = {
  dash: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  habits: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1.2 1.2L7.5 5"/><path d="M4 12l1.2 1.2L7.5 10"/><path d="M4 18l1.2 1.2L7.5 16"/>',
  cal: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  prog: '<path d="M3 20h18"/><path d="M6 20V11M11 20V5M16 20v-6M21 20v-9"/>',
  board: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/><path d="M10 20h4M12 14v6"/>',
  ach: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5"/>',
  chal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  set: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"/>',
  flame: '<path d="M12 3c.7 2.6 2.4 3.6 3.4 5.2A6 6 0 1 1 6 12c0-2.4 1.6-3.6 2.4-5.2.6 1 1.2 1.5 2 1.8C10.2 6.4 10.8 4.6 12 3Z"/>',
  google: '<path d="M20.6 12.2c0-.6-.05-1.2-.15-1.75H12v3.32h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.55Z"/><path d="M12 21c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H3.96v2.33A9 9 0 0 0 12 21Z"/><path d="M6.97 13.72a5.4 5.4 0 0 1 0-3.44V7.95H3.96a9 9 0 0 0 0 8.1l3.01-2.33Z"/><path d="M12 6.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C16.46 3.9 14.42 3 12 3a9 9 0 0 0-8.04 4.95l3.01 2.33C7.68 8.16 9.66 6.58 12 6.58Z"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8Z"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.6 20a6.4 6.4 0 0 1 12.8 0"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M17.5 20a6.4 6.4 0 0 0-2.2-4.85"/>'
};

const NAV = [
  ['Dashboard', ICON.dash, false],
  ['Habits', ICON.habits, false],
  ['Calendar', ICON.cal, false],
  ['Progress', ICON.prog, false],
  ['Leaderboard', ICON.board, true],
  ['Achievements', ICON.ach, false],
  ['Challenges', ICON.chal, true],
  ['Settings', ICON.set, false]
];

// Sync status is an actionable control, not a label: it states the connection, when it last
// ran and when it runs next, and opens the sync-details panel. `expired` maps to the
// needs_reauth state and offers Reconnect inline.
function syncWidget(state) {
  const chevron = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><path d="M9 5l7 7-7 7"/></svg>';

  if (state === 'expired') {
    return `    <div style="padding: 12px 14px; border-top: 1px solid var(--bad); background: color-mix(in oklab, var(--bad) 13%, transparent); display: flex; flex-direction: column; gap: 9px;">
      <div style="display: flex; align-items: flex-start; gap: 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" stroke-width="1.8" style="flex-shrink: 0; margin-top: 1px;"><path d="M12 3.5 22 20H2Z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>
        <span style="font-size: 11.5px; line-height: 1.35; color: var(--bad);">Google connection expired</span>
      </div>
      <div style="border: 1px solid var(--bad); background: var(--bad); color: var(--bg); padding: 6px 0; text-align: center; font-family: 'Saira Condensed', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;">RECONNECT</div>
    </div>`;
  }

  if (state === 'syncing') {
    return `    <div style="padding: 11px 14px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 9px; color: var(--faint);">
      <div style="width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--accent); border-top-color: transparent; flex-shrink: 0;"></div>
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0;">
        <span style="font-size: 11.5px; color: var(--accent);">Syncing&hellip;</span>
        <span style="font-size: 9.5px; color: var(--faint);">Checking Google Tasks</span>
      </div>
      ${chevron}
    </div>`;
  }

  if (state === 'offline') {
    return `    <div style="padding: 11px 14px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 9px; color: var(--faint);">
      <div style="width: 7px; height: 7px; border-radius: 50%; background: var(--gold); flex-shrink: 0;"></div>
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0;">
        <span style="font-size: 11.5px; color: var(--gold);">Offline</span>
        <span style="font-size: 9.5px; color: var(--faint);">Last sync 42m ago</span>
        <span style="font-size: 9.5px; color: var(--faint);">2 changes queued</span>
      </div>
      ${chevron}
    </div>`;
  }

  return `    <div style="padding: 11px 14px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 9px; color: var(--faint);">
      <div style="width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex-shrink: 0;"></div>
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0;">
        <span style="font-size: 11.5px; color: var(--fg);">Connected</span>
        <span style="font-size: 9.5px; color: var(--faint);">Last sync 1m ago</span>
        <span style="font-size: 9.5px; color: var(--faint);">Next sync &lt; 1m</span>
      </div>
      ${chevron}
    </div>`;
}

function sidebar(active, sync = 'connected') {
  const rows = NAV.map(([label, path, p3]) => {
    const on = label === active;
    const fg = on ? 'var(--fg)' : (p3 ? 'var(--faint)' : 'var(--dim)');
    const stroke = on ? 'var(--accent)' : 'currentColor';
    const bg = on ? 'background: var(--panel2); ' : '';
    const edge = on ? 'var(--accent)' : 'transparent';
    const icon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.7">${path}</svg>`;
    const text = `<span style="${on ? 'font-weight: 600; letter-spacing: 0.01em;' : ''}">${label}</span>`;
    if (p3) {
      return `      <div style="display: flex; align-items: center; justify-content: space-between; padding: 9px 11px; ${bg}color: ${fg}; border-left: 2px solid ${edge};">
        <div style="display: flex; align-items: center; gap: 11px;">${icon}${text}</div>
        <span style="font-family: 'Saira Condensed', sans-serif; font-size: 9px; letter-spacing: 0.1em; color: var(--faint); border: 1px solid var(--line); padding: 1px 5px;">P3</span>
      </div>`;
    }
    return `      <div style="display: flex; align-items: center; gap: 11px; padding: 9px 11px; ${bg}color: ${fg}; border-left: 2px solid ${edge};">${icon}${text}</div>`;
  }).join('\n');

  return `  <div style="width: 202px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column;">
    <div style="padding: 22px 18px 20px; display: flex; align-items: center; gap: 13px; border-bottom: 1px solid var(--line);">
      <div style="position: relative; width: 42px; height: 46px; flex-shrink: 0;">
        <svg width="42" height="46" viewBox="0 0 42 46" fill="none"><path d="M21 1.5 39.5 12v22L21 44.5 2.5 34V12Z" fill="var(--panel2)" stroke="var(--accent)" stroke-width="1.5"/></svg>
        <span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: 'Saira Condensed', sans-serif; font-size: 21px; font-weight: 700; color: var(--accent); padding-bottom: 1px;">4</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <span style="font-family: 'Saira Condensed', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;">Focused</span>
        <span style="font-size: 10px; letter-spacing: 0.1em; color: var(--faint); text-transform: uppercase;">2,340 XP</span>
      </div>
    </div>
    <div style="padding: 12px 10px; display: flex; flex-direction: column; gap: 2px; flex-grow: 1;">
${rows}
    </div>
${syncWidget(sync)}
  </div>`;
}

function topbar(title, subtitle, right = '') {
  return `    <div style="flex-shrink: 0; padding: 20px 26px 18px; border-bottom: 1px solid var(--line); background: var(--panel); display: flex; align-items: center; justify-content: space-between; gap: 30px;">
      <div style="display: flex; flex-direction: column; gap: 3px;">
        <span style="font-family: 'Saira Condensed', sans-serif; font-size: 24px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; line-height: 1;">${title}</span>
        <span style="font-size: 10.5px; letter-spacing: 0.12em; color: var(--faint); text-transform: uppercase;">${subtitle}</span>
      </div>
      ${right}
    </div>`;
}

function page({ active, title, subtitle, right = '', body, sync = 'connected', w = W, h = H, chrome = true }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Saira:wght@400;500;600&display=swap">
  <style>
    body { margin: 0; font-family: 'Saira', system-ui, sans-serif; }
    a { color: oklch(0.72 0.18 300); text-decoration: none; }
    a:hover { color: oklch(0.82 0.15 300); }
    * { box-sizing: border-box; }
  </style>
</helmet>

<div style="{{themeVars}}; width: ${w}px; height: ${h}px; display: flex; background: var(--bg); color: var(--fg); font-size: 13px; overflow: hidden;">
${chrome ? sidebar(active, sync) + `

  <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
${topbar(title, subtitle, right)}
${body}
  </div>` : body}
</div>
</x-dc>

<script data-dc-script data-props='{"theme":{"editor":"enum","options":["dark","light"],"default":"dark","section":"Theme"},"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() {
    const dark = (this.props.theme ?? 'dark') === 'dark';
    return {
      themeVars: dark
        ? '--bg: oklch(0.14 0.020 285); --panel: oklch(0.185 0.024 285); --panel2: oklch(0.25 0.028 285); --line: oklch(0.30 0.028 285); --fg: oklch(0.94 0.008 285); --dim: oklch(0.73 0.016 285); --faint: oklch(0.57 0.020 285); --accent: oklch(0.72 0.18 300); --gold: oklch(0.82 0.14 85); --ok: oklch(0.78 0.16 150); --bad: oklch(0.70 0.17 25)'
        : '--bg: oklch(0.972 0.006 285); --panel: oklch(1 0 0); --panel2: oklch(0.945 0.010 285); --line: oklch(0.89 0.012 285); --fg: oklch(0.21 0.020 285); --dim: oklch(0.45 0.020 285); --faint: oklch(0.60 0.018 285); --accent: oklch(0.50 0.19 300); --gold: oklch(0.60 0.13 75); --ok: oklch(0.53 0.15 150); --bad: oklch(0.55 0.19 25)'
    };
  }
}
</script>
</body>
</html>
`;
}

// ---------- shared fragments ----------

const btn = (label, kind = 'ghost', extra = '') => {
  const s = kind === 'solid'
    ? 'border: 1px solid var(--accent); background: var(--accent); color: var(--bg);'
    : kind === 'danger'
      ? 'border: 1px solid var(--bad); background: transparent; color: var(--bad);'
      : 'border: 1px solid var(--line); background: transparent; color: var(--dim);';
  return `<div style="${s} padding: 7px 13px; font-family: 'Saira Condensed', sans-serif; font-size: 11.5px; font-weight: 600; letter-spacing: 0.1em; white-space: nowrap; ${extra}">${label}</div>`;
};

const label = (t) => `<span style="font-size: 10px; letter-spacing: 0.14em; color: var(--faint); text-transform: uppercase;">${t}</span>`;
const cardTitle = (t) => `<span style="font-family: 'Saira Condensed', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;">${t}</span>`;
const flame = (n, color = 'var(--gold)') => `<div style="display: flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8">${ICON.flame}</svg><span style="font-family: 'Saira Condensed', sans-serif; font-size: 12px; color: ${color};">${n}</span></div>`;

const toggle = (on) => on
  ? `<div style="width: 34px; height: 18px; border-radius: 9px; background: var(--accent); position: relative; flex-shrink: 0;"><div style="position: absolute; top: 2px; right: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--bg);"></div></div>`
  : `<div style="width: 34px; height: 18px; border-radius: 9px; background: var(--panel2); border: 1px solid var(--line); position: relative; flex-shrink: 0;"><div style="position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--faint);"></div></div>`;

const field = (name, value, hint = '') => `<div style="display: flex; flex-direction: column; gap: 6px;">
            ${label(name)}
            <div style="padding: 9px 12px; background: var(--bg); border: 1px solid var(--line); font-size: 13px; color: var(--fg);">${value}</div>
            ${hint ? `<span style="font-size: 10.5px; color: var(--faint);">${hint}</span>` : ''}
          </div>`;

writeFileSync('.gitkeep-build', '');

// ---------- Habits ----------

const habitRows = [
  ['Study AI', 'Mon–Fri · 18:00 · 2h', 3, 12, true, true],
  ['Coding', 'Mon–Sat · 10:00 · 2h', 4, 8, true, false],
  ['German', 'Daily · 20:00 · 45m', 2, 4, true, true],
  ['Exercise', 'Mon/Wed/Fri · 07:00 · 1h', 3, 0, true, false],
  ['Read', 'Daily · 22:30 · 30m', 2, 15, true, false],
  ['Journal', 'Sun · 21:00 · 15m', 1, 0, false, false]
].map(([name, sched, tier, streak, active, selected]) => `        <div style="display: flex; align-items: center; gap: 13px; padding: 13px 15px; background: ${selected ? 'var(--panel2)' : 'var(--panel)'}; border: 1px solid ${selected ? 'var(--accent)' : 'var(--line)'}; opacity: ${active ? '1' : '0.5'};">
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 7px;">
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;">${name}</span>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 9px; letter-spacing: 0.08em; color: var(--gold); border: 1px solid var(--gold); padding: 1px 4px;">T${tier}</span>
              ${active ? '' : '<span style="font-size: 9.5px; letter-spacing: 0.1em; color: var(--faint); border: 1px solid var(--line); padding: 1px 5px;">PAUSED</span>'}
            </div>
            <span style="font-size: 10.5px; color: var(--faint);">${sched}</span>
          </div>
          ${flame(streak, streak > 0 ? 'var(--gold)' : 'var(--faint)')}
        </div>`).join('\n');

const dayPills = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => {
  const on = i < 7;
  return `<div style="width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-family: 'Saira Condensed', sans-serif; font-size: 12px; font-weight: 600; border: 1px solid ${on ? 'var(--accent)' : 'var(--line)'}; background: ${on ? 'var(--accent)' : 'transparent'}; color: ${on ? 'var(--bg)' : 'var(--faint)'};">${d}</div>`;
}).join('');

const habitsBody = `    <div style="flex-grow: 1; display: flex; min-height: 0;">

      <div style="width: 372px; flex-shrink: 0; border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0;">
        <div style="padding: 15px 18px 12px; display: flex; align-items: center; justify-content: space-between;">
          ${label('6 habits · 5 active')}
          ${btn('+ NEW HABIT', 'solid')}
        </div>
        <div style="padding: 0 18px 18px; display: flex; flex-direction: column; gap: 8px; overflow: hidden;">
${habitRows}
        </div>
      </div>

      <div style="flex-grow: 1; padding: 18px 24px; display: flex; flex-direction: column; gap: 16px; min-width: 0; overflow: hidden;">

        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 9px;">
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 21px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;">German</span>
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 10px; letter-spacing: 0.08em; color: var(--gold); border: 1px solid var(--gold); padding: 2px 6px;">TIER 2</span>
          </div>
          <div style="display: flex; gap: 8px;">${btn('PAUSE')}${btn('SAVE', 'solid')}</div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">
          ${field('Habit name', 'German')}
          ${field('Google Tasks list', 'Habits', 'The app creates one task per day in this list')}
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${label('Repeats on')}
          <div style="display: flex; gap: 5px;">${dayPills}</div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px;">
          ${field('Time of day', '20:00')}
          ${field('Duration target', '45 minutes')}
          ${field('Reminder', '30 min before')}
        </div>

        <div style="border: 1px solid var(--line); background: var(--panel); padding: 15px 17px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            ${cardTitle('Progressive difficulty')}
            <span style="font-size: 10.5px; color: var(--faint);">Baseline 20m · now 45m</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            ${[1, 2, 3, 4, 5, 6].map((n) => `<div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;">
              <div style="width: 100%; height: 5px; background: ${n <= 2 ? 'var(--accent)' : 'var(--panel2)'};"></div>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 10px; color: ${n <= 2 ? 'var(--accent)' : 'var(--faint)'};">${n === 1 ? '20m' : n === 2 ? '45m' : n === 3 ? '50m' : n === 4 ? '55m' : n === 5 ? '60m' : '70m'}</span>
            </div>`).join('')}
          </div>
        </div>

        <div style="border: 1px solid var(--gold); background: var(--panel); padding: 15px 17px; display: flex; align-items: center; gap: 15px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.6" style="flex-shrink: 0;">${ICON.ach}</svg>
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0;">
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;">Level up suggested</span>
            <span style="font-size: 11px; color: var(--dim);">Week 8 completion was 67% — below the 70% hold band. Suggested: ease the target back to 35m until consistency recovers.</span>
          </div>
          <div style="display: flex; gap: 8px; flex-shrink: 0;">${btn('DISMISS')}${btn('APPLY', 'solid')}</div>
        </div>

      </div>
    </div>`;

writeFileSync('Habits.dc.html', page({
  active: 'Habits', title: 'Habits', subtitle: '6 habits · 5 active · tier 1–4',
  right: `<div style="display: flex; gap: 8px;">${btn('IMPORT FROM GOOGLE')}${btn('+ NEW HABIT', 'solid')}</div>`,
  body: habitsBody
}));

// ---------- Calendar ----------

const HOUR0 = 6, HOUR1 = 23, PXH = 31;
const dayNames = ['MON 17', 'TUE 18', 'WED 19', 'THU 20', 'FRI 21', 'SAT 22', 'SUN 23'];

// [day, name, startHour, durationHours, status]
const blocks = [
  [0, 'Exercise', 7, 1, 'done'], [0, 'Coding', 10, 2, 'done'], [0, 'Study AI', 18, 2, 'done'], [0, 'German', 20, 0.75, 'done'], [0, 'Read', 22.5, 0.5, 'done'],
  [1, 'Coding', 10, 2, 'done'], [1, 'Study AI', 18, 2, 'partial'], [1, 'German', 20, 0.75, 'miss'], [1, 'Read', 22.5, 0.5, 'done'],
  [2, 'Exercise', 7, 1, 'done'], [2, 'Coding', 10, 2, 'done'], [2, 'Study AI', 18, 2, 'done'], [2, 'German', 20, 0.75, 'done'], [2, 'Read', 22.5, 0.5, 'miss'],
  [3, 'Exercise', 7, 1, 'idle'], [3, 'Coding', 10, 2, 'done'], [3, 'Study AI', 18, 2, 'done'], [3, 'German', 20, 0.75, 'active'], [3, 'Read', 22.5, 0.5, 'idle'],
  [4, 'Exercise', 7, 1, 'idle'], [4, 'Coding', 10, 2, 'idle'], [4, 'Study AI', 18, 2, 'idle'], [4, 'German', 20, 0.75, 'idle'], [4, 'Read', 22.5, 0.5, 'idle'],
  [5, 'Coding', 10, 2, 'idle'], [5, 'German', 20, 0.75, 'idle'], [5, 'Read', 22.5, 0.5, 'idle'],
  [6, 'German', 20, 0.75, 'idle'], [6, 'Journal', 21, 0.25, 'idle'], [6, 'Read', 22.5, 0.5, 'idle']
];

const blockStyle = {
  done: 'background: color-mix(in oklab, var(--ok) 22%, transparent); border-left: 2px solid var(--ok); color: var(--ok);',
  partial: 'background: color-mix(in oklab, var(--gold) 20%, transparent); border-left: 2px solid var(--gold); color: var(--gold);',
  miss: 'background: color-mix(in oklab, var(--bad) 16%, transparent); border-left: 2px solid var(--bad); color: var(--bad);',
  active: 'background: color-mix(in oklab, var(--accent) 26%, transparent); border-left: 2px solid var(--accent); color: var(--accent); box-shadow: 0 0 14px -4px var(--accent);',
  idle: 'background: var(--panel2); border-left: 2px solid var(--line); color: var(--faint);'
};

const dayCols = dayNames.map((d, i) => {
  const isToday = i === 3;
  const items = blocks.filter((b) => b[0] === i).map(([, name, start, dur, status]) => {
    const top = (start - HOUR0) * PXH;
    const h = Math.max(dur * PXH - 2, 13);
    return `<div style="position: absolute; left: 2px; right: 2px; top: ${top}px; height: ${h}px; ${blockStyle[status]} padding: 2px 5px; overflow: hidden;"><span style="font-family: 'Saira Condensed', sans-serif; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;">${name}</span></div>`;
  }).join('');
  return `          <div style="flex-grow: 1; border-right: 1px solid var(--line); position: relative; ${isToday ? 'background: color-mix(in oklab, var(--accent) 6%, transparent);' : ''}">${items}</div>`;
}).join('\n');

const hourLabels = [];
for (let h = HOUR0; h <= HOUR1; h++) {
  hourLabels.push(`<div style="height: ${PXH}px; display: flex; align-items: flex-start; justify-content: flex-end; padding-right: 7px;"><span style="font-family: 'Saira Condensed', sans-serif; font-size: 9.5px; color: var(--faint); transform: translateY(-5px);">${String(h).padStart(2, '0')}:00</span></div>`);
}
const gridLines = [];
for (let h = HOUR0; h <= HOUR1; h++) {
  gridLines.push(`<div style="height: ${PXH}px; border-top: 1px solid var(--line);"></div>`);
}

const monthCells = [];
for (let i = 0; i < 35; i++) {
  const dayNum = i - 3;
  const inMonth = dayNum >= 1 && dayNum <= 31;
  const isToday = dayNum === 20;
  let dots = '';
  if (inMonth && dayNum <= 20) {
    const n = dayNum % 5 === 0 ? 2 : dayNum % 3 === 0 ? 4 : 5;
    const colors = ['var(--ok)', 'var(--ok)', 'var(--gold)', 'var(--ok)', 'var(--bad)'];
    dots = `<div style="display: flex; gap: 1.5px; justify-content: center;">${Array.from({ length: 5 }, (_, k) => `<div style="width: 3px; height: 3px; border-radius: 50%; background: ${k < n ? colors[k] : 'var(--line)'};"></div>`).join('')}</div>`;
  }
  monthCells.push(`<div style="aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 1px solid ${isToday ? 'var(--accent)' : 'transparent'}; background: ${isToday ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'transparent'};">
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 11px; color: ${!inMonth ? 'var(--line)' : isToday ? 'var(--accent)' : 'var(--dim)'};">${inMonth ? dayNum : ''}</span>
            ${dots}
          </div>`);
}

const calendarBody = `    <div style="flex-grow: 1; display: flex; min-height: 0;">

      <div style="width: 262px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 16px 18px; display: flex; flex-direction: column; gap: 18px; overflow: hidden;">
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            ${cardTitle('August 2026')}
            <div style="display: flex; gap: 4px; color: var(--faint);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px;">
            ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div style="text-align: center; font-family: 'Saira Condensed', sans-serif; font-size: 9px; letter-spacing: 0.08em; color: var(--faint); padding-bottom: 4px;">${d}</div>`).join('')}
${monthCells.join('\n')}
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 9px;">
          ${label('Legend')}
          ${[['var(--ok)', 'Completed'], ['var(--gold)', 'Partial'], ['var(--bad)', 'Missed'], ['var(--accent)', 'Running now'], ['var(--line)', 'Scheduled ahead']].map(([c, t]) => `<div style="display: flex; align-items: center; gap: 8px;"><div style="width: 9px; height: 9px; background: ${c};"></div><span style="font-size: 11px; color: var(--dim);">${t}</span></div>`).join('')}
        </div>

        <div style="border: 1px solid var(--line); background: var(--panel); padding: 13px 15px; display: flex; flex-direction: column; gap: 7px;">
          ${label('Selected · Thu 20')}
          <span style="font-size: 11.5px; color: var(--dim);">5 scheduled · 2 complete · 1 running</span>
          <span style="font-size: 11.5px; color: var(--faint);">Drag a block to move just that day. The habit's own schedule stays as it is.</span>
        </div>
      </div>

      <div style="flex-grow: 1; display: flex; flex-direction: column; min-width: 0;">
        <div style="flex-shrink: 0; padding: 12px 20px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; gap: 0;">
            ${['MONTH', 'WEEK', 'DAY'].map((v, i) => `<div style="padding: 6px 15px; border: 1px solid ${i === 1 ? 'var(--accent)' : 'var(--line)'}; background: ${i === 1 ? 'var(--accent)' : 'transparent'}; color: ${i === 1 ? 'var(--bg)' : 'var(--dim)'}; font-family: 'Saira Condensed', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; margin-left: ${i ? '-1px' : '0'};">${v}</div>`).join('')}
          </div>
          <span style="font-family: 'Saira Condensed', sans-serif; font-size: 13px; letter-spacing: 0.06em; color: var(--dim);">17 – 23 AUGUST · WEEK 8</span>
        </div>

        <div style="flex-shrink: 0; display: flex; border-bottom: 1px solid var(--line); padding-left: 46px;">
          ${dayNames.map((d, i) => `<div style="flex-grow: 1; padding: 8px 0; text-align: center; border-right: 1px solid var(--line); background: ${i === 3 ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'transparent'};"><span style="font-family: 'Saira Condensed', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: ${i === 3 ? 'var(--accent)' : 'var(--dim)'};">${d}</span></div>`).join('')}
        </div>

        <div style="flex-grow: 1; display: flex; overflow: hidden;">
          <div style="width: 46px; flex-shrink: 0;">${hourLabels.join('')}</div>
          <div style="flex-grow: 1; display: flex; position: relative;">
            <div style="position: absolute; inset: 0; display: flex; flex-direction: column; pointer-events: none;">${gridLines.join('')}</div>
${dayCols}
          </div>
        </div>
      </div>
    </div>`;

writeFileSync('Calendar.dc.html', page({
  active: 'Calendar', title: 'Calendar', subtitle: 'Week 8 · 17–23 August 2026',
  right: `<div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 10.5px; color: var(--faint);">Times and durations are set in the app — Google Tasks cannot store them</span></div>`,
  body: calendarBody
}));

// ---------- Progress ----------

function barChart(values, colorFn, w, h, maxOverride) {
  const max = maxOverride || Math.max(...values) * 1.15;
  const bw = w / values.length;
  return values.map((v, i) => {
    const bh = Math.max((v / max) * h, 2);
    return `<rect x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" fill="${colorFn(i, v)}"/>`;
  }).join('');
}

function linePath(values, w, h, max) {
  const step = w / (values.length - 1);
  return values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - (v / max) * h).toFixed(1)}`).join(' ');
}

const weekHours = [6.2, 7.4, 8.5, 8.1, 9.6, 10.2, 10.15, 12.67];
const weekPoints = [28, 33, 41, 38, 47, 52, 56, 63];
const weekCompletion = [58, 64, 71, 68, 79, 83, 81, 86];
const streakSeries = [1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const chartCard = (title, sub, svg, footer) => `        <div style="background: var(--panel); border: 1px solid var(--line); padding: 15px 17px; display: flex; flex-direction: column; gap: 11px; min-width: 0;">
          <div style="display: flex; align-items: baseline; justify-content: space-between;">
            ${cardTitle(title)}
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 13px; color: var(--ok);">${sub}</span>
          </div>
          ${svg}
          <span style="font-size: 10px; letter-spacing: 0.08em; color: var(--faint); text-transform: uppercase;">${footer}</span>
        </div>`;

const progressBody = `    <div style="flex-grow: 1; padding: 18px 24px; display: flex; gap: 16px; min-height: 0; overflow: hidden;">

      <div style="flex-grow: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0;">

        ${chartCard('Hours per week', '+23.2%', `<svg viewBox="0 0 300 96" style="width: 100%; height: 96px;">${barChart(weekHours, (i) => i === 7 ? 'var(--accent)' : 'var(--panel2)', 300, 96)}</svg>`, 'Week 1 → 8 · 12h 40m this week')}

        ${chartCard('Completion rate', '86%', `<svg viewBox="0 0 300 96" style="width: 100%; height: 96px;"><path d="${linePath(weekCompletion, 300, 88, 100)}" fill="none" stroke="var(--ok)" stroke-width="2"/>${weekCompletion.map((v, i) => `<circle cx="${(i * (300 / 7)).toFixed(1)}" cy="${(88 - (v / 100) * 88).toFixed(1)}" r="${i === 7 ? 3.5 : 2}" fill="${i === 7 ? 'var(--ok)' : 'var(--panel)'}" stroke="var(--ok)" stroke-width="1.5"/>`).join('')}</svg>`, '18 of 21 scheduled tasks completed')}

        ${chartCard('Points per week', '+12.5%', `<svg viewBox="0 0 300 96" style="width: 100%; height: 96px;">${barChart(weekPoints, (i) => i === 7 ? 'var(--gold)' : 'var(--panel2)', 300, 96)}</svg>`, '63 points · previous best 56')}

        ${chartCard('Streak', '12 days', `<svg viewBox="0 0 300 96" style="width: 100%; height: 96px;"><path d="${linePath(streakSeries, 300, 88, 14)} L300 88 L0 88 Z" fill="color-mix(in oklab, var(--gold) 18%, transparent)" stroke="none"/><path d="${linePath(streakSeries, 300, 88, 14)}" fill="none" stroke="var(--gold)" stroke-width="2"/></svg>`, 'Longest 12 · two resets in 25 days')}
      </div>

      <div style="width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 14px; min-height: 0;">

        <div style="background: var(--panel); border: 1px solid var(--accent); padding: 16px 18px; display: flex; flex-direction: column; gap: 13px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            ${cardTitle('Week 8 review')}
            <span style="font-size: 9.5px; letter-spacing: 0.1em; color: var(--accent); border: 1px solid var(--accent); padding: 2px 6px;">NEW</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 9px;">
            ${[['Total time', '12h 40m', 'var(--fg)'], ['Previous week', '10h 15m', 'var(--dim)'], ['Improvement', '+23.2%', 'var(--ok)'], ['Tasks completed', '18 / 21', 'var(--fg)'], ['Consistency', '85.7%', 'var(--fg)'], ['XP earned', '146', 'var(--accent)']].map(([k, v, c]) => `<div style="display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 7px; border-bottom: 1px solid var(--line);">
              <span style="font-size: 11.5px; color: var(--faint);">${k}</span>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 16px; font-weight: 700; color: ${c};">${v}</span>
            </div>`).join('')}
          </div>

          <div style="display: flex; gap: 10px;">
            <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;">
              ${label('Best')}
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 15px; font-weight: 700; color: var(--ok); text-transform: uppercase;">Coding 94%</span>
            </div>
            <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;">
              ${label('Weakest')}
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 15px; font-weight: 700; color: var(--bad); text-transform: uppercase;">German 67%</span>
            </div>
          </div>
        </div>

        <div style="background: var(--panel2); border: 1px solid var(--line); padding: 15px 17px; display: flex; flex-direction: column; gap: 9px; flex-grow: 1;">
          ${label('Automated analysis')}
          <span style="font-size: 12px; line-height: 1.55; color: var(--dim); text-wrap: pretty;">You improved total study time by <span style="color: var(--ok);">23.2%</span>, your largest gain in eight weeks. Coding held at 94% completion across six sessions.</span>
          <span style="font-size: 12px; line-height: 1.55; color: var(--dim); text-wrap: pretty;">German dropped to 67% — three of nine sessions missed, all after 20:00.</span>
          <div style="height: 1px; background: var(--line); margin: 3px 0;"></div>
          <span style="font-size: 10px; letter-spacing: 0.12em; color: var(--faint); text-transform: uppercase;">Recommendation</span>
          <span style="font-size: 12px; line-height: 1.55; color: var(--fg); text-wrap: pretty;">Hold Coding at tier 4. Ease German from 45m to 35m until consistency recovers above 80%.</span>
          <div style="flex-grow: 1;"></div>
          <div style="display: flex; gap: 8px;">${btn('DISMISS')}${btn('APPLY BOTH', 'solid')}</div>
        </div>
      </div>
    </div>`;

writeFileSync('Progress.dc.html', page({
  active: 'Progress', title: 'Progress', subtitle: 'Last 8 weeks · all habits',
  right: `<div style="display: flex; gap: 0;">${['WEEK', 'MONTH', 'ALL'].map((v, i) => `<div style="padding: 6px 15px; border: 1px solid ${i === 1 ? 'var(--accent)' : 'var(--line)'}; background: ${i === 1 ? 'var(--accent)' : 'transparent'}; color: ${i === 1 ? 'var(--bg)' : 'var(--dim)'}; font-family: 'Saira Condensed', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; margin-left: ${i ? '-1px' : '0'};">${v}</div>`).join('')}</div>`,
  body: progressBody
}));

// ---------- Achievements ----------

const badges = [
  ['First 7-Day Streak', 'Unlocked 4 Aug', true, 'var(--gold)'],
  ['10 Hours Studied', 'Unlocked 28 Jul', true, 'var(--gold)'],
  ['50 Tasks Completed', 'Unlocked 11 Aug', true, 'var(--gold)'],
  ['Beat Your Record', 'Unlocked 20 Aug', true, 'var(--accent)'],
  ['Comeback', 'Unlocked 12 Aug', true, 'var(--accent)'],
  ['Perfect Week', '3 of 5 days clean', false, 'var(--gold)'],
  ['100 Hours Studied', '61.4 of 100 hours', false, 'var(--faint)'],
  ['30-Day Streak', '12 of 30 days', false, 'var(--faint)']
];

const badgeGrid = badges.map(([name, sub, unlocked, color]) => `          <div style="background: ${unlocked ? 'var(--panel)' : 'var(--panel2)'}; border: 1px solid ${unlocked ? color : 'var(--line)'}; padding: 16px 14px; display: flex; flex-direction: column; align-items: center; gap: 9px; text-align: center; ${unlocked ? '' : 'opacity: 0.62;'}">
            <div style="position: relative; width: 46px; height: 50px;">
              <svg width="46" height="50" viewBox="0 0 42 46" fill="none"><path d="M21 1.5 39.5 12v22L21 44.5 2.5 34V12Z" fill="${unlocked ? 'color-mix(in oklab, ' + color + ' 16%, transparent)' : 'transparent'}" stroke="${unlocked ? color : 'var(--line)'}" stroke-width="1.5"/></svg>
              <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${unlocked ? color : 'var(--faint)'}" stroke-width="1.7">${unlocked ? ICON.ach : ICON.lock}</svg>
              </div>
            </div>
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; line-height: 1.15;">${name}</span>
            <span style="font-size: 10px; color: var(--faint);">${sub}</span>
          </div>`).join('\n');

const records = [
  ['Longest streak', '12 days', '4–15 August'],
  ['Most hours in a week', '12h 40m', 'Week 8'],
  ['Most points in a week', '63', 'Week 8'],
  ['Highest completion rate', '94%', 'Coding · week 7'],
  ['Most productive day', '5h 12m', 'Wed 19 August'],
  ['Most improved habit', 'Coding +38%', 'Week 6 → 8']
];

const achievementsBody = `    <div style="flex-grow: 1; display: flex; min-height: 0; overflow: hidden;">

      <div style="flex-grow: 1; padding: 18px 24px; display: flex; flex-direction: column; gap: 14px; min-width: 0;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          ${label('5 of 8 unlocked')}
          <div style="display: flex; align-items: center; gap: 10px; width: 240px;">
            <div style="flex-grow: 1; height: 4px; background: var(--panel2); overflow: hidden;"><div style="width: 62.5%; height: 100%; background: var(--gold);"></div></div>
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 12px; color: var(--gold);">62%</span>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
${badgeGrid}
        </div>
      </div>

      <div style="width: 314px; flex-shrink: 0; border-left: 1px solid var(--line); padding: 18px 20px; display: flex; flex-direction: column; gap: 14px;">
        ${cardTitle('Personal records')}
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${records.map(([k, v, when]) => `<div style="background: var(--panel); border: 1px solid var(--line); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 10px; letter-spacing: 0.12em; color: var(--faint); text-transform: uppercase;">${k}</span>
            <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px;">
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 19px; font-weight: 700; letter-spacing: 0.01em; color: var(--fg);">${v}</span>
              <span style="font-size: 10.5px; color: var(--faint);">${when}</span>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>`;

writeFileSync('Achievements.dc.html', page({
  active: 'Achievements', title: 'Achievements', subtitle: '5 of 8 unlocked · 6 personal records',
  body: achievementsBody
}));

// ---------- Settings ----------

const scoreRows = [
  ['Full completion', '+2'], ['Partial completion', '+1'], ['Skipped', '0'], ['Unjustified skip', '−1'],
  ['Beat weekly target', '+5'], ['Worst-day completion', '+3'], ['7-day consistency', '+10']
];

const notifRows = [
  ['Upcoming habit', '30 minutes before the scheduled time', true],
  ['Completion', 'When a habit is ticked here or in Google', true],
  ['Streak alive', 'A nudge if a streak is at risk after 21:00', true],
  ['Weekly review', 'When the new week’s review is generated', false]
];

const settingsBody = `    <div style="flex-grow: 1; padding: 18px 24px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; min-height: 0; overflow: hidden;">

      <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0;">

        <div style="background: var(--panel); border: 1px solid var(--ok); padding: 16px 18px; display: flex; flex-direction: column; gap: 13px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            ${cardTitle('Google account')}
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="width: 6px; height: 6px; background: var(--ok);"></div>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 11px; letter-spacing: 0.1em; color: var(--ok);">CONNECTED</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="var(--dim)" style="flex-shrink: 0;">${ICON.google}</svg>
            <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span style="font-size: 13px; color: var(--fg);">you@example.com</span>
              <span style="font-size: 10.5px; color: var(--faint);">Google Tasks · list &ldquo;Habits&rdquo; · 1 permission granted</span>
            </div>
            ${btn('DISCONNECT', 'danger')}
          </div>
          <div style="background: var(--bg); border: 1px solid var(--line); padding: 11px 13px; display: flex; flex-direction: column; gap: 5px;">
            <span style="font-size: 10px; letter-spacing: 0.12em; color: var(--faint); text-transform: uppercase;">Permission granted</span>
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 12px; color: var(--dim); letter-spacing: 0.02em;">.../auth/tasks &mdash; read and update your tasks</span>
            <span style="font-size: 10.5px; color: var(--faint); line-height: 1.5; text-wrap: pretty;">This app cannot see your calendar, mail, contacts or files. Disconnecting revokes the token and keeps all of your habit history.</span>
          </div>
        </div>

        <div style="background: var(--panel); border: 1px solid var(--line); padding: 16px 18px; display: flex; flex-direction: column; gap: 13px;">
          ${cardTitle('Synchronisation')}
          <div style="display: flex; flex-direction: column; gap: 7px;">
            <div style="display: flex; align-items: baseline; justify-content: space-between;">
              <span style="font-size: 12px; color: var(--dim);">Check Google every</span>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 15px; font-weight: 700; color: var(--accent);">5 MINUTES</span>
            </div>
            <div style="height: 4px; background: var(--panel2); position: relative;">
              <div style="width: 26%; height: 100%; background: var(--accent);"></div>
              <div style="position: absolute; left: 26%; top: 50%; width: 12px; height: 12px; background: var(--accent); transform: translate(-50%, -50%);"></div>
            </div>
            <div style="display: flex; justify-content: space-between;"><span style="font-size: 10px; color: var(--faint);">1 min</span><span style="font-size: 10px; color: var(--faint);">60 min</span></div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 11px; border-top: 1px solid var(--line);">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 12px; color: var(--fg);">Create tasks ahead</span>
              <span style="font-size: 10.5px; color: var(--faint);">How far in advance tasks appear in Google</span>
            </div>
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 14px; font-weight: 700; color: var(--fg);">7 DAYS</span>
          </div>
          <span style="font-size: 10.5px; color: var(--faint); line-height: 1.5; text-wrap: pretty;">Google Tasks offers no push notifications, so changes are picked up on this interval rather than instantly.</span>
        </div>

        <div style="background: var(--panel); border: 1px solid var(--line); padding: 16px 18px; display: flex; flex-direction: column; gap: 11px; flex-grow: 1;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            ${cardTitle('Appearance')}
            <div style="display: flex; gap: 0;">
              ${['DARK', 'LIGHT', 'SYSTEM'].map((v, i) => `<div style="padding: 5px 13px; border: 1px solid ${i === 0 ? 'var(--accent)' : 'var(--line)'}; background: ${i === 0 ? 'var(--accent)' : 'transparent'}; color: ${i === 0 ? 'var(--bg)' : 'var(--dim)'}; font-family: 'Saira Condensed', sans-serif; font-size: 10.5px; font-weight: 600; letter-spacing: 0.1em; margin-left: ${i ? '-1px' : '0'};">${v}</div>`).join('')}
            </div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 10px; border-top: 1px solid var(--line);">
            <span style="font-size: 12px; color: var(--fg);">Start with Windows</span>${toggle(true)}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 12px; color: var(--fg);">Minimise to system tray</span>${toggle(true)}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 12px; color: var(--fg);">Reduce animation</span>${toggle(false)}
          </div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0;">

        <div style="background: var(--panel); border: 1px solid var(--line); padding: 16px 18px; display: flex; flex-direction: column; gap: 11px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            ${cardTitle('Scoring')}
            ${btn('RESET TO DEFAULTS')}
          </div>
          ${scoreRows.map(([k, v], i) => `<div style="display: flex; align-items: center; justify-content: space-between; ${i === 4 ? 'margin-top: 6px; padding-top: 11px; border-top: 1px solid var(--line);' : ''}">
            <span style="font-size: 12px; color: ${i < 4 ? 'var(--fg)' : 'var(--dim)'};">${k}</span>
            <div style="display: flex; align-items: center; gap: 9px;">
              <div style="width: 22px; height: 22px; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--faint); font-size: 13px;">&minus;</div>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 16px; font-weight: 700; width: 30px; text-align: center; color: ${v.startsWith('+') ? 'var(--ok)' : v.startsWith('−') ? 'var(--bad)' : 'var(--faint)'};">${v}</span>
              <div style="width: 22px; height: 22px; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--faint); font-size: 13px;">+</div>
            </div>
          </div>`).join('')}
        </div>

        <div style="background: var(--panel); border: 1px solid var(--line); padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; flex-grow: 1;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 9px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.7">${ICON.bell}</svg>
              ${cardTitle('Notifications')}
            </div>
            ${toggle(true)}
          </div>
          ${notifRows.map(([k, sub, on]) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-top: 11px; border-top: 1px solid var(--line);">
            <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span style="font-size: 12px; color: var(--fg);">${k}</span>
              <span style="font-size: 10.5px; color: var(--faint);">${sub}</span>
            </div>${toggle(on)}
          </div>`).join('')}
          <div style="flex-grow: 1;"></div>
          <div style="background: var(--bg); border: 1px solid var(--line); padding: 11px 13px; display: flex; flex-direction: column; gap: 4px;">
            ${label('Data')}
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 11.5px; color: var(--dim);">Recompute all statistics from records</span>
              ${btn('RECOMPUTE')}
            </div>
          </div>
        </div>
      </div>
    </div>`;

writeFileSync('Settings.dc.html', page({
  active: 'Settings', title: 'Settings', subtitle: 'Account · sync · scoring · notifications',
  body: settingsBody
}));

// ---------- Phase 3 placeholders ----------

function placeholder({ active, title, subtitle, icon, lead, points }) {
  const body = `    <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; padding: 30px 60px; min-height: 0;">
      <div style="max-width: 560px; display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center;">

        <div style="position: relative; width: 84px; height: 92px;">
          <svg width="84" height="92" viewBox="0 0 42 46" fill="none"><path d="M21 1.5 39.5 12v22L21 44.5 2.5 34V12Z" fill="var(--panel)" stroke="var(--line)" stroke-width="1.5"/></svg>
          <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="1.4">${icon}</svg>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 9px; align-items: center;">
          <span style="font-family: 'Saira Condensed', sans-serif; font-size: 26px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;">${title}</span>
          <span style="font-size: 10px; letter-spacing: 0.16em; color: var(--accent); border: 1px solid var(--accent); padding: 3px 10px; text-transform: uppercase;">Phase 3</span>
        </div>

        <span style="font-size: 13px; line-height: 1.6; color: var(--dim); text-wrap: pretty;">${lead}</span>

        <div style="width: 100%; background: var(--panel); border: 1px solid var(--line); padding: 18px 22px; display: flex; flex-direction: column; gap: 11px; text-align: left;">
          ${label('What will land here')}
          ${points.map((p) => `<div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="width: 5px; height: 5px; background: var(--accent); margin-top: 6px; flex-shrink: 0;"></div>
            <span style="font-size: 12px; line-height: 1.5; color: var(--dim); text-wrap: pretty;">${p}</span>
          </div>`).join('')}
        </div>

        <span style="font-size: 11px; line-height: 1.55; color: var(--faint); text-wrap: pretty;">Your Google Tasks content never leaves this device. Only the figures you explicitly choose to share are ever sent.</span>
      </div>
    </div>`;
  return page({ active, title, subtitle, body });
}

writeFileSync('Leaderboard.dc.html', placeholder({
  active: 'Leaderboard', title: 'Leaderboard', subtitle: 'Not built yet · phase 3', icon: ICON.users,
  lead: 'Friend groups and shared leaderboards need a server to sync between people, so they come after the Google synchronisation is proven reliable.',
  points: [
    'Create a group, generate an invite code, and share a weekly leaderboard with friends.',
    'Five separate rankings — hours, consistency, improvement, streak and XP — so someone aiming at 10 hours a week can still win against someone aiming at 30.',
    'Per-field privacy switches: share XP and completion percentage while keeping habit names and task contents entirely private.'
  ]
}));

writeFileSync('Challenges.dc.html', placeholder({
  active: 'Challenges', title: 'Challenges', subtitle: 'Not built yet · phase 3', icon: ICON.chal,
  lead: 'Weekly challenges are scored against the same group data as the leaderboard, so they arrive together with it.',
  points: [
    'Most Hours, Most Consistent, Biggest Improvement and Streak Battle, each running for one week.',
    'Scored on improvement against your own previous week, not on raw totals, so a challenge stays winnable at any target size.',
    'Opt in per challenge — sitting one out costs you nothing and does not affect your own streaks or XP.'
  ]
}));

// ---------- Dashboard ----------

const RING = 2 * Math.PI * 26;

function habitCard({ name, detail, pct, streak, xp, tier, action, kind }) {
  const color = kind === 'done' ? 'var(--ok)' : kind === 'active' ? 'var(--accent)' : 'var(--faint)';
  const filled = RING * (pct / 100);
  const dash = `${filled.toFixed(1)} ${(RING - filled).toFixed(1)}`;
  const isActive = kind === 'active';
  return `        <div style="background: var(--panel); border: 1px solid ${isActive ? 'var(--accent)' : 'var(--line)'}; padding: 16px 18px; display: flex; align-items: center; gap: 18px; ${isActive ? 'box-shadow: 0 0 0 1px var(--accent), 0 6px 22px -8px var(--accent);' : ''} min-width: 0;">
          <div style="position: relative; width: 62px; height: 62px; flex-shrink: 0;">
            <svg width="62" height="62" viewBox="0 0 62 62">
              <circle cx="31" cy="31" r="26" fill="none" stroke="var(--panel2)" stroke-width="5"/>
              <circle cx="31" cy="31" r="26" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${dash}" transform="rotate(-90 31 31)"/>
            </svg>
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 17px; font-weight: 700; color: ${color};">${pct}</span>
            </div>
          </div>
          <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 7px; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 9.5px; letter-spacing: 0.08em; color: var(--gold); border: 1px solid var(--gold); padding: 1px 5px; flex-shrink: 0;">T${tier}</span>
            </div>
            <span style="font-size: 11px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${detail}</span>
            <div style="display: flex; align-items: center; gap: 14px;">
              ${flame(streak, streak > 0 ? 'var(--gold)' : 'var(--faint)')}
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 12px; letter-spacing: 0.05em; color: var(--accent);">${xp} XP</span>
            </div>
          </div>
          <div style="flex-shrink: 0; padding: 7px 13px; border: 1px solid ${isActive ? 'var(--accent)' : 'var(--line)'}; background: ${isActive ? 'var(--accent)' : 'transparent'}; color: ${isActive ? 'var(--bg)' : 'var(--dim)'}; font-family: 'Saira Condensed', sans-serif; font-size: 11.5px; font-weight: 600; letter-spacing: 0.1em; white-space: nowrap;">${action}</div>
        </div>`;
}

const xpTrack = Array.from({ length: 20 }, (_, i) => `<div style="flex-grow: 1; background: ${i < 16 ? 'var(--accent)' : 'var(--panel2)'};"></div>`).join('');

const dashboardBody = `    <div style="flex-grow: 1; padding: 20px 26px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 14px; min-height: 0;">
${habitCard({ name: 'Study AI', detail: '2h 00m of 2h · ticked in Google', pct: 100, streak: 12, xp: '+20', tier: 3, action: 'DONE', kind: 'done' })}
${habitCard({ name: 'Coding', detail: '1h 58m of 2h · ticked in Google', pct: 98, streak: 8, xp: '+20', tier: 4, action: 'DONE', kind: 'done' })}
${habitCard({ name: 'German', detail: '27m of 45m · timer running', pct: 60, streak: 4, xp: '+15', tier: 2, action: 'STOP', kind: 'active' })}
${habitCard({ name: 'Exercise', detail: 'Not started · 1h target', pct: 0, streak: 0, xp: '+20', tier: 3, action: 'START', kind: 'idle' })}
${habitCard({ name: 'Read', detail: 'Not started · 30m target', pct: 0, streak: 15, xp: '+10', tier: 2, action: 'START', kind: 'idle' })}
        <div style="background: var(--panel2); border: 1px dashed var(--line); padding: 16px 18px; display: flex; flex-direction: column; justify-content: center; gap: 9px;">
          ${label('Next unlock')}
          <div style="display: flex; align-items: center; gap: 11px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.6">${ICON.ach}</svg>
            <div style="display: flex; flex-direction: column; gap: 1px;">
              <span style="font-family: 'Saira Condensed', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;">Perfect Week</span>
              <span style="font-size: 10.5px; color: var(--faint);">3 of 5 days clean &middot; 2 to go</span>
            </div>
          </div>
          <div style="height: 3px; background: var(--line); overflow: hidden;"><div style="width: 60%; height: 100%; background: var(--gold);"></div></div>
        </div>
    </div>`;

writeFileSync('Main.dc.html', page({
  active: 'Dashboard', title: 'Thursday 20 August', subtitle: 'Week 8 · Day score 4 / 8',
  right: `<div style="flex-grow: 1; max-width: 380px; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          ${label('Level 4 &rarr; 5')}
          <span style="font-family: 'Saira Condensed', sans-serif; font-size: 12px; letter-spacing: 0.06em; color: var(--dim);">660 XP TO ELITE</span>
        </div>
        <div style="display: flex; gap: 2px; height: 8px;">${xpTrack}</div>
      </div>`,
  body: dashboardBody
}));

// ---------- Sync states sheet ----------

const detailRow = (k, v, c = 'var(--fg)') => `<div style="display: flex; align-items: baseline; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid var(--line);">
          <span style="font-size: 11px; color: var(--faint);">${k}</span>
          <span style="font-family: 'Saira Condensed', sans-serif; font-size: 13px; font-weight: 600; color: ${c};">${v}</span>
        </div>`;

const logLine = (time, text, c) => `<div style="display: flex; gap: 9px; align-items: baseline;">
          <span style="font-family: 'Saira Condensed', sans-serif; font-size: 10px; color: var(--faint); flex-shrink: 0; width: 34px;">${time}</span>
          <span style="font-size: 10.5px; line-height: 1.4; color: ${c}; text-wrap: pretty;">${text}</span>
        </div>`;

const stateStrip = (title, state) => `      <div style="display: flex; flex-direction: column; gap: 7px;">
        ${label(title)}
        <div style="width: 202px; background: var(--panel); border: 1px solid var(--line);">
${syncWidget(state)}
        </div>
      </div>`;

const syncPanelConnected = `    <div style="width: 318px; background: var(--panel); border: 1px solid var(--line); display: flex; flex-direction: column;">
      <div style="padding: 14px 17px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between;">
        ${cardTitle('Sync details')}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </div>
      <div style="padding: 14px 17px; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 9px;">
          <div style="width: 7px; height: 7px; border-radius: 50%; background: var(--ok);"></div>
          <span style="font-size: 12.5px; color: var(--fg);">Connected to Google Tasks</span>
        </div>
        <div style="display: flex; flex-direction: column;">
          ${detailRow('Last sync', '20:43 · 1m ago')}
          ${detailRow('Next sync', '20:48 · &lt; 1m', 'var(--accent)')}
          ${detailRow('Interval', 'Every 5 minutes')}
          ${detailRow('Task list', 'Habits')}
          ${detailRow('Created ahead', '7 days · 31 tasks')}
        </div>
        <div style="display: flex; gap: 8px;">
          ${[['12', 'PULLED'], ['3', 'PUSHED'], ['0', 'QUEUED']].map(([n, t]) => `<div style="flex-grow: 1; background: var(--bg); border: 1px solid var(--line); padding: 9px 0; display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <span style="font-family: 'Saira Condensed', sans-serif; font-size: 18px; font-weight: 700; color: var(--fg);">${n}</span>
            <span style="font-size: 8.5px; letter-spacing: 0.12em; color: var(--faint);">${t}</span>
          </div>`).join('')}
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${label('Recent activity')}
          ${logLine('20:43', 'Study AI completed in Google — +20 XP, streak 12', 'var(--ok)')}
          ${logLine('20:43', 'Pushed German status to Google', 'var(--dim)')}
          ${logLine('20:38', 'Created 3 tasks for 23–25 August', 'var(--dim)')}
          ${logLine('20:33', 'No changes', 'var(--faint)')}
        </div>
        <div style="display: flex; gap: 8px;">
          ${btn('SYNC NOW', 'solid', 'flex-grow: 1; text-align: center;')}
          ${btn('SETTINGS', 'ghost', 'flex-grow: 1; text-align: center;')}
        </div>
      </div>
    </div>`;

const syncPanelExpired = `    <div style="width: 318px; background: var(--panel); border: 1px solid var(--bad); display: flex; flex-direction: column;">
      <div style="padding: 14px 17px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between;">
        ${cardTitle('Sync details')}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </div>
      <div style="padding: 14px 17px; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; align-items: flex-start; gap: 9px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" stroke-width="1.8" style="flex-shrink: 0; margin-top: 1px;"><path d="M12 3.5 22 20H2Z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>
          <span style="font-size: 12.5px; line-height: 1.4; color: var(--bad);">Google connection expired</span>
        </div>
        <span style="font-size: 11.5px; line-height: 1.55; color: var(--dim); text-wrap: pretty;">Google revoked the stored token. This happens every 7 days while the OAuth consent screen is still in <span style="color: var(--fg);">Testing</span> — switching it to <span style="color: var(--fg);">In production</span> stops it.</span>
        <div style="display: flex; flex-direction: column;">
          ${detailRow('Last successful sync', '18 Aug · 2d ago', 'var(--bad)')}
          ${detailRow('Failed since', '32 attempts')}
          ${detailRow('Queued changes', '2 waiting', 'var(--gold)')}
        </div>
        <div style="background: var(--bg); border: 1px solid var(--line); padding: 11px 13px; display: flex; flex-direction: column; gap: 4px;">
          ${label('Meanwhile')}
          <span style="font-size: 10.5px; line-height: 1.5; color: var(--faint); text-wrap: pretty;">Everything still works offline — timer, scoring, streaks and charts. Your 2 queued changes are sent as soon as you reconnect.</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${btn('RECONNECT GOOGLE', 'solid', 'text-align: center;')}
          ${logLine('18 Aug', 'invalid_grant — token expired or revoked', 'var(--bad)')}
        </div>
      </div>
    </div>`;

const syncStatesBody = `  <div style="flex-grow: 1; padding: 26px 30px; display: flex; gap: 30px; min-width: 0;">
    <div style="display: flex; flex-direction: column; gap: 20px; flex-shrink: 0;">
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <span style="font-family: 'Saira Condensed', sans-serif; font-size: 21px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;">Sync status &mdash; states</span>
        <span style="font-size: 11px; line-height: 1.5; color: var(--faint); max-width: 230px; text-wrap: pretty;">Sits at the foot of the sidebar on every screen. Clicking it opens the panel on the right.</span>
      </div>
${stateStrip('Connected', 'connected')}
${stateStrip('Syncing', 'syncing')}
${stateStrip('Offline · queued', 'offline')}
${stateStrip('needs_reauth', 'expired')}
    </div>

    <div style="display: flex; flex-direction: column; gap: 9px;">
      ${label('Click &rarr; sync details')}
${syncPanelConnected}
    </div>

    <div style="display: flex; flex-direction: column; gap: 9px;">
      ${label('Click &rarr; when expired')}
${syncPanelExpired}
    </div>
  </div>`;

writeFileSync('SyncStates.dc.html', page({
  active: '', title: '', subtitle: '', chrome: false, w: 1120, h: 700, body: syncStatesBody
}));

console.log('generated: Dashboard, Habits, Calendar, Progress, Achievements, Settings, Leaderboard, Challenges, SyncStates');
