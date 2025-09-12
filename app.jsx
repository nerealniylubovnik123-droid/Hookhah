
const Card = ({ className = "", children }) => (
  <div className={`rounded-2xl border border-slate-800 bg-slate-900 ${className}`}>{children}</div>
);
const CardHeader = ({ className = "", children }) => (<div className={`px-3 pt-3 ${className}`}>{children}</div>);
const CardContent = ({ className = "", children }) => (<div className={`p-3 ${className}`}>{children}</div>);
const Button = ({ className = "", children, onClick, disabled, variant = "default", size = "sm", type = "button", title }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={[
      "inline-flex items-center justify-center rounded-xl",
      size === "sm" ? "h-9 px-3 text-[12px]" : "h-10 px-4 text-[14px]",
      variant === "outline" ? "border border-slate-700 bg-transparent hover:bg-slate-800"
        : variant === "ghost" ? "bg-transparent hover:bg-slate-800"
        : "bg-slate-100 text-slate-900 hover:bg-white",
      disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      className,
    ].join(" ")}
  >{children}</button>
);
const Input = ({ className = "", ...props }) => (
  <input className={`h-9 w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 placeholder-slate-400 px-3 text-sm outline-none focus:ring-2 focus:ring-slate-600 ${className}`} {...props} />
);
const Textarea = ({ className = "", ...props }) => (
  <textarea className={`min-h-[72px] w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-100 placeholder-slate-400 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-600 ${className}`} {...props} />
);
const Badge = ({ className = "", children, variant = "outline" }) => (
  <span className={[
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] border",
    variant === "outline" ? "border-slate-700 text-slate-200 bg-slate-900" : "bg-slate-100 text-slate-900 border-transparent",
    className,
  ].join(" ")}>{children}</span>
);

const safeNum = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const safePercent = (v) => Math.max(0, Math.min(100, safeNum(v, 0)));
const percentSum = (parts=[]) => (Array.isArray(parts) ? parts.reduce((a, b) => a + safePercent(b?.percent), 0) : 0);
const isMixValid = (parts, title) => (Array.isArray(parts) ? (parts.length > 0 && percentSum(parts) === 100 && String(title||"").trim().length >= 3) : false);
const clampPercentForPart = (parts, targetId, newVal) => { const otherSum = percentSum(parts.filter((x) => x?.flavorId !== targetId)); return Math.max(0, Math.min(safePercent(newVal), 100 - otherSum)); };
const normalizeBrand = (b) => (b || "").trim();
const BRAND_STRENGTH10_DEFAULTS = { Darkside: 5, "Black Burn": 6, BlackBurn: 6, MustHave: 5, Overdos: 6, Bonch: 7, Starline: 3 };
const getStrength10 = (f) => { if (!f) return 5; if (typeof f.strength10 === 'number' && Number.isFinite(f.strength10)) return Math.max(1, Math.min(10, f.strength10)); const byBrand = BRAND_STRENGTH10_DEFAULTS[normalizeBrand(f.brand)] ?? 5; return byBrand; };
const strengthColor = (v) => { if (v == null) return { bg: "bg-slate-800", text: "text-slate-200", border: "border-slate-700" }; if (v < 4) return { bg: "bg-emerald-950", text: "text-emerald-300", border: "border-emerald-800" }; if (v < 7) return { bg: "bg-amber-950", text: "text-amber-300", border: "border-amber-800" }; return { bg: "bg-rose-950", text: "text-rose-300", border: "border-rose-800" }; };
const uuidv4 = () => { let dt = Date.now(); if (typeof performance !== "undefined" && typeof performance.now === "function") dt += performance.now(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,(c)=>{const r=(dt+Math.random()*16)%16|0;dt=Math.floor(dt/16);const v=c==="x"?r:(r&0x3)|0x8;return v.toString(16);}); };
const tasteWordFromTag = (tag) => { if (tag == null) return null; const t = String(tag).toLowerCase().trim(); if (!t) return null; const rules = [[/кисл|sour|лимон|lime|грейпфрут/, "кислый"],[/сладк|sweet|sugar|мед|honey/, "сладкий"],[/прян|spice|ginger|имбир/, "пряный"],[/лед|ice|cold|frost|мят/, "ледяной"],[/фрукт|fruit|яблок|banana|mango|pineapple|grape|orange|pear|melon|berry/, "фруктовый"],[/десерт|dessert|cake|pie|cookie|choco|cream|vanilla|waffle/, "десертный"]]; for (const [re,w] of rules) if (re.test(t)) return w; return null; };
const calcMixStrengthValue10 = (parts, flavors) => { if (!Array.isArray(parts) || !Array.isArray(flavors)) return null; const total = percentSum(parts); if (!parts.length || total <= 0) return null; let weighted = 0; for (const p of parts) { const percent = safePercent(p?.percent); if (percent <= 0) continue; const fl = flavors.find((x) => x && x.id === p?.flavorId); if (!fl) continue; weighted += getStrength10(fl) * (percent / total); } return weighted ? Math.round(weighted * 10) / 10 : null; };
const getMixTasteLabel = (parts, flavors) => { if (!Array.isArray(parts) || !Array.isArray(flavors) || parts.length === 0) return null; const total = percentSum(parts); if (total <= 0) return null; const scores = new Map(); const add=(raw,w)=>{const word=tasteWordFromTag(raw); if(word) scores.set(word,(scores.get(word)||0)+w);}; for(const p of parts){const w=safePercent(p?.percent); if(w<=0) continue; const fl=flavors.find(f=>f&&f.id===p?.flavorId); if(!fl) continue; if(fl.tags) for(const t of fl.tags) add(t,w); if(fl.name) for(const tk of String(fl.name).toLowerCase().split(/[^a-zа-я0-9]+/i)) add(tk,Math.max(1,w*0.6)); if(fl.description) for(const tk of String(fl.description).toLowerCase().split(/[^a-zа-я0-9]+/i)) add(tk,Math.max(1,w*0.3)); } if(!scores.size) return null; return Array.from(scores.entries()).sort((a,b)=>b[1]-a[1])[0][0]||null; };

function App() {
  const [flavors, setFlavors] = React.useState([]);
  const [activeBrand, setActiveBrand] = React.useState("");
  const [parts, setParts] = React.useState([]);
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [guestMixes, setGuestMixes] = React.useState([]);
  const [activeTab, setActiveTab] = React.useState("builder"); // builder | guest
  const [user, setUser] = React.useState(null);

  // Telegram auth (WebApp)
  React.useEffect(() => {
    try {
      const u = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      if (u) {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || `User ${u.id}`;
        setUser({ id: u.id, name, username: u.username });
      }
    } catch {}
  }, []);

  // Auto-load flavors with polling; auto-reload on changes
  React.useEffect(() => {
    let lastHash = null;
    let timer = null;
    async function fetchOnce() {
      try {
        const res = await fetch("./hookah_flavors.json", { cache: "no-store" });
        if (res.ok) {
          const txt = await res.text();
          const hash = btoa(unescape(encodeURIComponent(txt))).slice(0, 24);
          if (hash !== lastHash) {
            lastHash = hash;
            const arr = JSON.parse(txt);
            if (Array.isArray(arr)) {
              const cleaned = arr.map((x) => ({
                id: String(x.id || `${x.brand}-${x.name}`).trim(),
                brand: String(x.brand || "").trim(),
                name: String(x.name || "").trim(),
                description: x.description != null ? String(x.description) : undefined,
                tags: Array.isArray(x.tags) ? x.tags : (typeof x.tags === 'string' ? x.tags.split(/[;,|]/).map(s=>s.trim()).filter(Boolean) : undefined),
                strength10: typeof x.strength10 === 'number' ? x.strength10 : undefined,
              })).filter((x) => x.id && x.brand && x.name);
              if (cleaned.length) {
                setFlavors(cleaned);
                setActiveBrand((prev)=> prev || normalizeBrand(cleaned[0].brand));
              }
            }
          }
        }
      } catch {}
    }
    fetchOnce();
    timer = setInterval(fetchOnce, 8000);
    return () => clearInterval(timer);
  }, []);

  // Load saved mixes from file and localStorage
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch('./guest_mixes.json', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setGuestMixes(data);
        }
      } catch {}
      try {
        const ls = localStorage.getItem('guest_mixes');
        if (ls) {
          const arr = JSON.parse(ls);
          if (Array.isArray(arr) && arr.length) setGuestMixes(arr);
        }
      } catch {}
    })();
  }, []);

  const brands = React.useMemo(() => { const s = new Set((flavors || []).map((f) => normalizeBrand(f.brand))); return Array.from(s).filter(Boolean).sort(); }, [flavors]);
  const flavorsOfActive = React.useMemo(() => (flavors || []).filter((f) => normalizeBrand(f.brand) === activeBrand), [flavors, activeBrand]);

  const total = percentSum(parts);
  const isValid = isMixValid(parts, title);
  const mixStrength10 = calcMixStrengthValue10(parts, flavors);
  const mixTaste = getMixTasteLabel(parts, flavors);

  const addToMix = (flavorId) => { setParts((prev) => { if (!flavorId) return prev; if (prev.some((p) => p.flavorId === flavorId)) return prev; const defaultPercent = Math.min(30, Math.max(0, 100 - percentSum(prev))); return [...prev, { flavorId, percent: defaultPercent }]; }); };
  const updatePercent = (flavorId, value) => { const requested = safePercent(value); setParts((prev) => prev.map((p) => (p.flavorId === flavorId ? { ...p, percent: clampPercentForPart(prev, flavorId, requested) } : p))); };
  const removePart = (flavorId) => setParts((prev) => prev.filter((p) => p.flavorId !== flavorId));

  const saveGuestMix = () => {
    if (!user) return;
    if (!isValid) return;
    const mix = {
      id: uuidv4(),
      title: String(title).trim(),
      parts: [...parts],
      notes: String(notes || "").trim(),
      author: user?.name || "Гость",
      createdAt: Date.now(),
      taste: mixTaste || null,
      strength10: mixStrength10 ?? null,
    };
    const updated = [mix, ...guestMixes].slice(0,500);
    setGuestMixes(updated);
    try { localStorage.setItem('guest_mixes', JSON.stringify(updated)); } catch {}
    // Offer download of updated guest_mixes.json so it can be uploaded to the same folder on server
    try {
      const blob = new Blob([JSON.stringify(updated, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'guest_mixes.json'; a.style.display='none';
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch {}
    setTitle(""); setNotes(""); setParts([]);
    setActiveTab("guest");
  };

  // Auth screen
  if (!user) {
    return (
      <div className="min-h-[100svh] bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <Card className="w-full max-w-sm text-center shadow">
          <CardHeader>
            <div className="flex items-center justify-center mb-2">
              <img src="./logo.jpg" alt="logo" className="w-16 h-16 rounded-full" />
            </div>
            <div className="text-lg font-bold">Вход через Telegram</div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-slate-300">Чтобы сохранять миксы под вашим именем, откройте приложение внутри Telegram.</div>
            <Button onClick={() => { try { window?.Telegram?.WebApp?.openTelegramLink?.("https://t.me"); } catch{} }}>Открыть Telegram</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100svh] bg-slate-950 text-slate-100 p-3">
      <div className="mx-auto w-full max-w-md space-y-3">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <img src="./logo.jpg" alt="logo" className="w-8 h-8 rounded" />
            <h1 className="text-lg font-bold truncate">Hookah Mixes</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge>Здравствуйте, {user?.name}</Badge>
            <Button variant={activeTab==='builder'? 'default':'outline'} onClick={()=>setActiveTab('builder')}>Конструктор</Button>
            <Button variant={activeTab==='guest'? 'default':'outline'} onClick={()=>setActiveTab('guest')}>Миксы гостей</Button>
          </div>
        </header>

        {activeTab === 'builder' && (
          <>
            <Card>
              <CardHeader><div className="text-xs font-semibold">Бренды</div></CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-1">
                  {brands.map((b) => (
                    <Button key={b} variant="outline" className={activeBrand === b ? "bg-slate-100 text-slate-900" : ""} onClick={() => setActiveBrand(b)}>{b}</Button>
                  ))}
                  {brands.length === 0 && (<div className="text-[12px] text-slate-400">Файл hookah_flavors.json не найден</div>)}
                </div>
                {activeBrand && (
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400">Вкусы бренда: {activeBrand}</div>
                    {flavorsOfActive.map((f) => {
                      const inMix = parts.some((p) => p.flavorId === f.id);
                      const s = getStrength10(f);
                      const c = strengthColor(s);
                      return (
                        <div key={f.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-medium truncate" title={`${f.brand} • ${f.name}`}>{f.name}</div>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] border ${c.bg} ${c.text} ${c.border}`}>{s.toFixed(1)}</span>
                            </div>
                            {f.description && <div className="text-[11px] text-slate-400 truncate">{f.description}</div>}
                          </div>
                          <Button size="sm" className="h-8 px-2" disabled={inMix} onClick={() => addToMix(f.id)}>{inMix ? "✓" : "+"}</Button>
                        </div>
                      );
                    })}
                    {flavorsOfActive.length === 0 && (<div className="text-[12px] text-slate-400">Нет вкусов для этого бренда</div>)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><div className="text-xs font-semibold">Микс</div></CardHeader>
              <CardContent className="space-y-2">
                {parts.length === 0 && (<div className="text-[12px] text-slate-400">Добавьте вкусы из списка бренда</div>)}
                {parts.map((p) => {
                  const fl = flavors.find((f) => f.id === p.flavorId);
                  return (
                    <div key={p.flavorId} className="flex items-center gap-2 text-sm">
                      <span className="truncate w-36" title={fl?.name}>{fl?.name || p.flavorId}</span>
                      <input type="range" min={0} max={100} step={5} className="w-28" value={safePercent(p.percent)} onChange={(e) => updatePercent(p.flavorId, Number(e.target.value))} />
                      <span className="w-10 text-right">{safePercent(p.percent)}%</span>
                      <Button variant="ghost" className="h-8 px-2" onClick={() => removePart(p.flavorId)}>Удалить</Button>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between text-[12px]">
                  <span>Итог: {total}%</span>
                  <div className="flex items-center gap-2">
                    {typeof mixStrength10 === 'number' && (()=>{ const c = strengthColor(mixStrength10); return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] border ${c.bg} ${c.text} ${c.border}`}>{mixStrength10.toFixed(1)}</span>; })()}
                    {mixTaste && <Badge>{mixTaste}</Badge>}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><div className="text-xs font-semibold">Название и описание</div></CardHeader>
              <CardContent className="space-y-2">
                <Input placeholder="Название микса" value={title} onChange={(e) => setTitle(e.target.value)} />
                <Textarea placeholder="Описание / заметки…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setTitle(""); setNotes(""); setParts([]); }}>Сброс</Button>
                  <Button disabled={!isValid} onClick={saveGuestMix}>Сохранить</Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === 'guest' && (
          <Card>
            <CardHeader><div className="text-xs font-semibold">Миксы гостей</div></CardHeader>
            <CardContent className="space-y-2">
              {guestMixes.length === 0 && <div className="text-[12px] text-slate-400">Пока нет сохранённых миксов</div>}
              {guestMixes.map((m) => {
                const c = typeof m.strength10 === 'number' ? strengthColor(m.strength10) : strengthColor(null);
                return (
                  <div key={m.id} className="border border-slate-800 rounded-xl p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate">{m.title}</div>
                      {typeof m.strength10 === 'number' && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] border ${c.bg} ${c.text} ${c.border}`}>{m.strength10.toFixed(1)}</span>}
                      {m.taste && <Badge>{m.taste}</Badge>}
                    </div>
                    <div className="text-[11px] text-slate-400">микс от {m.author || 'Гость'}</div>
                    {m.notes && <div className="text-[12px] opacity-80 mt-1">{m.notes}</div>}
                    <div className="mt-1 space-y-0.5">
                      {(m.parts || []).map((p) => {
                        const fl = flavors.find(f => f.id === p.flavorId);
                        return (
                          <div key={p.flavorId} className="flex items-center justify-between text-[12px]">
                            <span className="truncate mr-2">{fl ? `${fl.name}` : p.flavorId}</span>
                            <span className="opacity-70">{safePercent(p.percent)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

const Root = () => React.createElement(App);
