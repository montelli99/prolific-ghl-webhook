import { useState, useEffect, useRef, useMemo } from 'react';

const API_BASE = 'http://127.0.0.1:3002';
const DEFAULT_FONT_SIZE = 3; // rem
const DEFAULT_WPM = 200;
const WPM_TO_PX_PER_SEC = (wpm, fontSizeRem) => {
  // Average word = 5 chars. At wpm WPM, that's wpm/60 words/sec.
  // Approximate line height: fontSize * 1.4
  // px per second = (wpm / 60) * 5 chars * (fontSize * 0.6) * 1.4
  return (wpm / 60) * 5 * (fontSizeRem * 0.6 * 16) * 1.4 / 5;
};

function highlightPlaceholders(text) {
  if (!text) return null;
  const parts = text.split(/(\{[\w_]+\})/g);
  return parts.map((p, i) => {
    if (p.match(/^\{[\w_]+\}$/)) {
      return <span key={i} className="placeholder">{p}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

export default function App() {
  const [stages, setStages] = useState([]);
  const [labels, setLabels] = useState({});
  const [owners, setOwners] = useState({});
  const [buckets, setBuckets] = useState({});
  const [currentStage, setCurrentStage] = useState('CONTACT_MADE');
  const [script, setScript] = useState(null);
  const [variables, setVariables] = useState({});
  const [showStagePicker, setShowStagePicker] = useState(false);
  const [showVarForm, setShowVarForm] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [scrollPos, setScrollPos] = useState(0);
  const [error, setError] = useState(null);
  
  const scrollerRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);

  // Load stages on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/stages`)
      .then(r => r.json())
      .then(d => {
        setStages(d.stages);
        setLabels(d.labels);
        setOwners(d.owners);
        setBuckets(d.buckets);
      })
      .catch(e => setError(`Failed to load stages: ${e.message}`));
  }, []);

  // Load script when currentStage or variables change
  useEffect(() => {
    fetch(`${API_BASE}/api/script/${currentStage}`)
      .then(r => r.json())
      .then(d => {
        setScript(d.script);
        // Auto-populate variables from script's declared list
        const initialVars = {};
        (d.script.variables || []).forEach(v => {
          if (variables[v] === undefined) initialVars[v] = '';
        });
        if (Object.keys(initialVars).length > 0) {
          setVariables(prev => ({ ...prev, ...initialVars }));
        }
        setScrollPos(0);
      })
      .catch(e => setError(`Failed to load script: ${e.message}`));
  }, [currentStage]);

  // Re-render script with current variables (live)
  const renderedScript = useMemo(() => {
    if (!script) return null;
    const substitute = (text) => {
      if (!text) return text;
      return text.replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] || match;
      });
    };
    return {
      ...script,
      opener: substitute(script.opener),
      close: substitute(script.close),
      goal: substitute(script.goal),
      discovery: (script.discovery || []).map(substitute),
      objection: Object.fromEntries(
        Object.entries(script.objection || {}).map(([k, v]) => [substitute(k), substitute(v)])
      )
    };
  }, [script, variables]);

  // Auto-scroll animation loop
  useEffect(() => {
    if (!scrolling) {
      cancelAnimationFrame(animFrameRef.current);
      lastTimeRef.current = 0;
      return;
    }
    const tick = (ts) => {
      if (!lastTimeRef.current) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000;
      lastTimeRef.current = ts;
      velocityRef.current = WPM_TO_PX_PER_SEC(wpm, fontSize);
      setScrollPos(p => {
        const next = p + velocityRef.current * dt;
        const maxScroll = scrollerRef.current 
          ? scrollerRef.current.scrollHeight - scrollerRef.current.clientHeight
          : 0;
        if (next >= maxScroll) {
          setScrolling(false);
          return maxScroll;
        }
        return next;
      });
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [scrolling, wpm, fontSize]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          setScrolling(s => !s);
          break;
        case 'Escape':
          setShowStagePicker(false);
          setShowVarForm(false);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setWpm(w => Math.min(500, w + 25));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setWpm(w => Math.max(50, w - 25));
          break;
        case 'g':
        case 'G':
          setShowStagePicker(s => !s);
          break;
        case 'v':
        case 'V':
          setShowVarForm(s => !s);
          break;
        case 'r':
        case 'R':
          setScrollPos(0);
          break;
        case '+':
        case '=':
          setFontSize(s => Math.min(6, s + 0.25));
          break;
        case '-':
          setFontSize(s => Math.max(1.5, s - 0.25));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) {
    return (
      <div className="app" style={{ padding: '2rem' }}>
        <h1 style={{ color: 'var(--red)' }}>❌ Error</h1>
        <p>{error}</p>
        <p style={{ color: 'var(--gray)', marginTop: '1rem' }}>
          Make sure the backend is running: <code>cd backend &amp;&amp; npm start</code>
        </p>
      </div>
    );
  }

  if (!renderedScript) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Loading teleprompter...</h2>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="controls">
        <button onClick={() => setShowStagePicker(true)}>
          📋 Stage: {labels[currentStage] || currentStage}
        </button>
        <button onClick={() => setShowVarForm(s => !s)}>
          ✏️ Vars ({Object.keys(variables).filter(k => variables[k]).length})
        </button>
        <button onClick={() => setScrolling(s => !s)} className={scrolling ? 'danger' : 'primary'}>
          {scrolling ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={() => setScrollPos(0)}>⏮ Reset</button>
        <div className="stage-info">
          <div className="label">{renderedScript.title}</div>
          <div className="owner">Owner: {owners[currentStage]}</div>
        </div>
      </div>

      <div className="scroller-wrap" ref={scrollerRef}>
        <div
          className="scroller"
          style={{
            transform: `translateY(-${scrollPos}px)`,
            fontSize: `${fontSize}rem`
          }}
        >
          <div className="section">
            <div className="section-label">🎯 Goal</div>
            <div>{highlightPlaceholders(renderedScript.goal)}</div>
          </div>

          <div className="section">
            <div className="section-label">👋 Opener</div>
            <div>{highlightPlaceholders(renderedScript.opener)}</div>
          </div>

          {renderedScript.discovery && renderedScript.discovery.length > 0 && (
            <div className="section">
              <div className="section-label">❓ Discovery Questions</div>
              <ul style={{ listStyle: 'none' }}>
                {renderedScript.discovery.map((q, i) => (
                  <li key={i} style={{ marginBottom: '0.5em' }}>• {highlightPlaceholders(q)}</li>
                ))}
              </ul>
            </div>
          )}

          {renderedScript.objection && Object.keys(renderedScript.objection).length > 0 && (
            <div className="section">
              <div className="section-label">⚡ Objection Handling</div>
              {Object.entries(renderedScript.objection).map(([q, a], i) => (
                <div key={i} style={{ marginBottom: '1em' }}>
                  <div className="objection-q">"{q}"</div>
                  <div className="objection-a">→ {a}</div>
                </div>
              ))}
            </div>
          )}

          <div className="section">
            <div className="section-label">🎬 Close / Next Step</div>
            <div>{highlightPlaceholders(renderedScript.close)}</div>
          </div>

          {renderedScript.red_flags && renderedScript.red_flags.length > 0 && (
            <div className="section">
              <div className="section-label" style={{ color: 'var(--red)' }}>🚩 Red Flags</div>
              <ul style={{ listStyle: 'none' }}>
                {renderedScript.red_flags.map((rf, i) => (
                  <li key={i} className="red-flag">⚠ {rf}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="bottom-bar">
        <div className="speed-control">
          <span>WPM:</span>
          <input
            type="range"
            min="50" max="500" step="25"
            value={wpm}
            onChange={e => setWpm(Number(e.target.value))}
          />
          <span className="wpm-display">{wpm}</span>
        </div>
        <div className="speed-control">
          <span>Font:</span>
          <input
            type="range"
            min="1.5" max="6" step="0.25"
            value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
          />
          <span>{fontSize}rem</span>
        </div>
        <div className="key-hint">
          <kbd>Space</kbd> play/pause • <kbd>↑↓</kbd> speed • <kbd>+-</kbd> font • <kbd>G</kbd> stages • <kbd>V</kbd> vars • <kbd>R</kbd> reset
        </div>
      </div>

      {showStagePicker && (
        <div className="stage-picker" onClick={() => setShowStagePicker(false)}>
          <div className="stage-picker-grid" onClick={e => e.stopPropagation()}>
            <h2>📋 Pick a Stage</h2>
            <button className="close" onClick={() => setShowStagePicker(false)}>✕</button>
            {Object.entries(buckets).map(([bucket, stageList]) => (
              <div key={bucket} style={{ display: 'contents' }}>
                <div className="bucket-header">{bucket} ({stageList.length} stages)</div>
                {stageList.map(s => (
                  <button key={s} onClick={() => { setCurrentStage(s); setShowStagePicker(false); }}>
                    {labels[s]}
                    <div className="owner">{owners[s]}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {showVarForm && (
        <div className="stage-picker" onClick={() => setShowVarForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1f2937', padding: '2rem', borderRadius: '12px', maxWidth: '600px', width: '90%' }}>
            <h2 style={{ color: 'var(--accent)', marginBottom: '1rem' }}>✏️ Variables</h2>
            <p style={{ color: 'var(--gray)', marginBottom: '1rem' }}>
              Fill in the values for placeholders in this stage. Press Enter to apply.
            </p>
            <div className="variables-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {(script?.variables || []).map(v => (
                <div key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <label style={{ minWidth: '160px', color: 'var(--gray)' }}>{v}:</label>
                  <input
                    type="text"
                    value={variables[v] || ''}
                    onChange={e => setVariables(prev => ({ ...prev, [v]: e.target.value }))}
                    placeholder={`Enter ${v}...`}
                    style={{ flex: 1 }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setVariables({})}>Clear All</button>
              <button className="primary" onClick={() => setShowVarForm(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
