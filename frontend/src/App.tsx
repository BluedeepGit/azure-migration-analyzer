import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info' | 'Ready';

interface AuthConfig { useManagedIdentity: boolean; tenantId: string; clientId: string; clientSecret: string; }
interface Subscription { subscriptionId: string; displayName: string; tenantId: string; }
interface ResourceGroup { name: string; subscriptionId: string; location: string; }
interface Region { name: string; displayName: string; }
interface Issue { severity: string; message: string; impact: string; workaround: string; downtimeRisk: boolean; refLink?: string; }
interface Resource { id: string; name: string; type: string; resourceGroup: string; subscriptionId: string; subscriptionName?: string; location: string; migrationStatus: Severity; issues: Issue[]; }
interface Summary { total: number; blockers: number; critical: number; warnings: number; ready: number; downtimeRisks: number; }
interface ApiResponse { scenario: MigrationScenario; summary: Summary; details: Resource[]; targetRegion?: string; }

// Tipi per il Test
interface LogicFailure { row: number; resource: string; scenario: string; expected: string; got: string; }
interface LinkFailure { file: string; ruleId: string; url: string; status: string | number; }
interface TestResult {
    logic: { passed: number; failed: number; total: number; failures: LogicFailure[]; };
    links: { checked: number; broken: number; details: LinkFailure[]; };
}

const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

function App() {
  const [view, setView] = useState<'config' | 'report' | 'test'>('config');
  
  // Config
  const [auth, setAuth] = useState<AuthConfig>({ useManagedIdentity: true, tenantId: '', clientId: '', clientSecret: '' });
  const [isConnecting, setIsConnecting] = useState(false);
  const [availableSubs, setAvailableSubs] = useState<Subscription[]>([]);
  const [availableRegions, setAvailableRegions] = useState<Region[]>([]);
  
  // Selection
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [scenario, setScenario] = useState<MigrationScenario>('cross-tenant');
  const [targetRegion, setTargetRegion] = useState('');
  
  // RG Selection
  const [availableRGs, setAvailableRGs] = useState<ResourceGroup[]>([]);
  const [selectedRGs, setSelectedRGs] = useState<string[]>([]);
  const [loadingRGs, setLoadingRGs] = useState(false);

  // Data
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // UI
  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<string>('All');
  
  // Test Data
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // --- ACTIONS ---
  const connectToAzure = async () => {
    setIsConnecting(true); setError('');
    try {
      const payload = auth.useManagedIdentity ? {} : { auth };
      const res = await axios.post('/api/login', payload);
      setAvailableSubs(res.data.subscriptions);
      if(res.data.subscriptions.length > 0) setSelectedSubs([res.data.subscriptions[0].subscriptionId]);
      
      if(res.data.subscriptions.length > 0) {
          try {
            const regRes = await axios.post('/api/regions', { auth: auth.useManagedIdentity ? undefined : auth, subscriptionId: res.data.subscriptions[0].subscriptionId });
            setAvailableRegions(regRes.data);
          } catch(e) { console.error("Region fetch error", e); }
      }
    } catch (err: any) { setError(err.response?.data?.error || err.message); } 
    finally { setIsConnecting(false); }
  };

  useEffect(() => {
    if (availableSubs.length > 0 && selectedSubs.length > 0 && scenario !== 'cross-tenant') fetchResourceGroups();
    else { setAvailableRGs([]); setSelectedRGs([]); }
  }, [selectedSubs, scenario]);

  const fetchResourceGroups = async () => {
      setLoadingRGs(true);
      try {
          const res = await axios.post('/api/resource-groups', { auth: auth.useManagedIdentity ? undefined : auth, subscriptions: selectedSubs });
          setAvailableRGs(res.data);
          setSelectedRGs(res.data.map((rg:any) => rg.name));
      } catch (err) { console.error(err); } finally { setLoadingRGs(false); }
  };

  const runAnalysis = async () => {
    if (selectedSubs.length === 0) { setError("Seleziona almeno una sottoscrizione."); return; }
    setLoading(true); setError(''); setView('report');
    try {
      const payload = {
        scenario, subscriptions: selectedSubs, resourceGroups: scenario === 'cross-tenant' ? undefined : selectedRGs,
        targetRegion: scenario === 'cross-region' ? targetRegion : undefined,
        auth: auth.useManagedIdentity ? undefined : auth
      };
      const response = await axios.post('/api/analyze', payload);
      setData(response.data);
      const newExpS: any = {};
      response.data.details.forEach((r:any) => newExpS[r.subscriptionId] = true);
      setExpandedSubs(newExpS);
    } catch (err: any) { setError(err.response?.data?.error || err.message); setView('config'); } 
    finally { setLoading(false); }
  };

  const runDiagnostics = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await axios.get('/api/admin/run-test');
      setTestResult(res.data);
    } catch (err: any) { alert("Errore Test: " + err.message); } 
    finally { setTestLoading(false); }
  };

  // --- UI HELPER (Re-inseriti i missing handlers) ---
  
  const handleSubToggle = (id: string) => {
      setSelectedSubs(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleRGToggle = (name: string) => {
      setSelectedRGs(prev => prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name]);
  };

  const getStatusBadge = (status: string) => {
     const styles: any = { 'Blocker': 'bg-red-800 text-white', 'Critical': 'bg-red-100 text-red-800', 'Warning': 'bg-orange-100 text-orange-800', 'Info': 'bg-blue-100 text-blue-800', 'Ready': 'bg-green-100 text-green-800' };
     return <span className={`px-2 py-0.5 rounded text-xs font-bold border ${styles[status]}`}>{status}</span>;
  };

  const groupedData = useMemo(() => {
    if (!data) return [];
    const filtered = data.details.filter(r => filterStatus === 'All' || (filterStatus === 'Downtime' ? r.issues.some(i => i.downtimeRisk) : r.migrationStatus === filterStatus));
    const tree: any = {};
    filtered.forEach(res => {
      let subName = res.subscriptionName || availableSubs.find(s => s.subscriptionId === res.subscriptionId)?.displayName || res.subscriptionId;
      if (!tree[res.subscriptionId]) tree[res.subscriptionId] = { id: res.subscriptionId, name: subName, groups: {}, worstStatus: 'Ready' };
      const subNode = tree[res.subscriptionId];
      if (!subNode.groups[res.resourceGroup]) subNode.groups[res.resourceGroup] = [];
      subNode.groups[res.resourceGroup].push(res);
      if (SEVERITY_WEIGHT[res.migrationStatus] > SEVERITY_WEIGHT[subNode.worstStatus]) subNode.worstStatus = res.migrationStatus;
    });
    return Object.values(tree).map((subNode:any) => ({
      ...subNode,
      groupList: Object.keys(subNode.groups).map(rgName => {
        const resources = subNode.groups[rgName];
        let rgWorst = 'Ready';
        resources.forEach((r:any) => { if (SEVERITY_WEIGHT[r.migrationStatus] > SEVERITY_WEIGHT[rgWorst]) rgWorst = r.migrationStatus; });
        return { name: rgName, resources, worstStatus: rgWorst };
      }).sort((a:any, b:any) => SEVERITY_WEIGHT[b.worstStatus] - SEVERITY_WEIGHT[a.worstStatus])
    })).sort((a:any, b:any) => SEVERITY_WEIGHT[b.worstStatus] - SEVERITY_WEIGHT[a.worstStatus]);
  }, [data, filterStatus, availableSubs]);

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans text-gray-900">
      
      {/* NAVBAR */}
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
         <h1 className="font-bold text-lg text-blue-700">Azure Migration Console</h1>
         
         <div className="flex gap-2">
            <button 
                onClick={() => setView('config')} 
                className={`px-4 py-2 text-sm font-bold rounded transition-colors ${view==='config' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
                Config
            </button>
            <button 
                onClick={() => setView('report')} 
                disabled={!data} 
                className={`px-4 py-2 text-sm font-bold rounded transition-colors ${view==='report' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100 disabled:opacity-50'}`}
            >
                Report
            </button>
            <button 
                onClick={() => setView('test')} 
                className={`px-4 py-2 text-sm font-bold rounded transition-colors border-2 ${view==='test' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'text-purple-600 border-purple-100 hover:bg-purple-50'}`}
            >
                Diagnostica
            </button>
         </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        
        {/* VIEW 1: CONFIG */}
        {view === 'config' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white p-5 rounded shadow-sm border">
                <h2 className="font-bold mb-3">1. Accesso</h2>
                <div className="mb-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auth.useManagedIdentity} onChange={e => setAuth({...auth, useManagedIdentity: e.target.checked})} /> Managed Identity</label></div>
                {!auth.useManagedIdentity && <div className="space-y-2 mb-3"><input className="w-full border p-2 text-sm rounded" placeholder="Tenant ID" value={auth.tenantId} onChange={e => setAuth({...auth, tenantId: e.target.value})} /><input className="w-full border p-2 text-sm rounded" placeholder="Client ID" value={auth.clientId} onChange={e => setAuth({...auth, clientId: e.target.value})} /><input className="w-full border p-2 text-sm rounded" type="password" placeholder="Secret" value={auth.clientSecret} onChange={e => setAuth({...auth, clientSecret: e.target.value})} /></div>}
                <button onClick={connectToAzure} disabled={isConnecting} className="w-full bg-blue-600 text-white py-2 rounded text-sm font-bold">{isConnecting ? '...' : 'Connetti'}</button>
                {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
                {availableSubs.length > 0 && <div className="mt-4 border rounded max-h-60 overflow-y-auto">{availableSubs.map(s => <div key={s.subscriptionId} className="p-2 border-b flex items-center"><input type="checkbox" checked={selectedSubs.includes(s.subscriptionId)} onChange={() => handleSubToggle(s.subscriptionId)} /><span className="ml-2 text-xs font-bold">{s.displayName}</span></div>)}</div>}
            </div>
            <div className="lg:col-span-2 bg-white p-5 rounded shadow-sm border">
                <h2 className="font-bold mb-4">2. Scenario</h2>
                <div className="grid grid-cols-2 gap-4 mb-6">
                    {['cross-tenant', 'cross-subscription', 'cross-resourcegroup', 'cross-region'].map(s => (
                        <div key={s} onClick={() => setScenario(s as any)} className={`p-4 border rounded cursor-pointer ${scenario === s ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'hover:border-gray-400'}`}><div className="font-bold capitalize">{s.replace('cross-', '').replace('-', ' to ')}</div></div>
                    ))}
                </div>
                {scenario !== 'cross-tenant' && (
                    <div className="mb-4">
                         <div className="flex justify-between items-end mb-2"><label className="text-sm font-bold">Resource Groups</label><div className="space-x-2 text-xs"><button onClick={() => setSelectedRGs(availableRGs.map(r=>r.name))} className="text-blue-600">Select All</button> <button onClick={() => setSelectedRGs([])} className="text-red-600">Deselect All</button></div></div>
                         {loadingRGs ? <div className="text-xs italic">Loading...</div> : <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto border p-2 rounded">{availableRGs.map(rg => <label key={rg.name} className="flex gap-1 text-xs items-center"><input type="checkbox" checked={selectedRGs.includes(rg.name)} onChange={() => handleRGToggle(rg.name)} /> <span className="truncate" title={rg.name}>{rg.name}</span></label>)}</div>}
                    </div>
                )}
                {scenario === 'cross-region' && <div className="mb-4"><label className="text-sm font-bold">Target Region</label><select value={targetRegion} onChange={e=>setTargetRegion(e.target.value)} className="w-full border p-2 rounded"><option value="">Select</option>{availableRegions.map(r=><option key={r.name} value={r.name}>{r.displayName} ({r.name})</option>)}</select></div>}
                <button onClick={runAnalysis} disabled={loading || selectedSubs.length === 0} className="w-full bg-green-600 text-white py-4 rounded font-bold">{loading ? 'Analisi...' : 'AVVIA ANALISI'}</button>
            </div>
          </div>
        )}

        {/* --- VIEW 2: REPORT --- */}
        {view === 'report' && data && (
            <div className="animate-fade-in space-y-6">
                <div className="flex gap-4 overflow-x-auto pb-2">
                    {['Total', 'Blockers', 'Critical', 'Warnings', 'Ready'].map(k => (
                        <div key={k} onClick={() => setFilterStatus(k === 'Total' ? 'All' : k.slice(0, -1))} className="bg-white p-4 rounded border shadow-sm flex-1 cursor-pointer hover:bg-gray-50">
                            <div className="text-xs text-gray-500 uppercase font-bold">{k}</div>
                            <div className="text-2xl font-bold">{(data.summary as any)[k.toLowerCase()] || (data.summary as any)[k.toLowerCase()+'s']}</div>
                        </div>
                    ))}
                </div>
                {groupedData.map((sub:any) => (
                    <div key={sub.id} className="bg-white border rounded shadow-sm overflow-hidden">
                        <div onClick={() => setExpandedSubs({...expandedSubs, [sub.id]: !expandedSubs[sub.id]})} className="bg-gray-100 p-4 flex justify-between cursor-pointer">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-yellow-100 rounded text-yellow-700">🔑</div>
                                <div><div className="font-bold text-lg">{sub.name}</div><div className="text-xs font-mono">{sub.id}</div></div>
                            </div>
                            {getStatusBadge(sub.worstStatus)}
                        </div>
                        {expandedSubs[sub.id] && <div className="p-4 space-y-4">
                            {sub.groupList.map((rg:any) => (
                                <div key={rg.name} className="border rounded">
                                    <div onClick={() => setExpandedGroups(p => ({...p, [`${sub.id}-${rg.name}`]: !p[`${sub.id}-${rg.name}`]}))} className="p-3 flex justify-between cursor-pointer hover:bg-gray-50">
                                        <div className="font-bold text-sm">RG: {rg.name}</div>
                                        {getStatusBadge(rg.worstStatus)}
                                    </div>
                                    {expandedGroups[`${sub.id}-${rg.name}`] && <div className="border-t p-2">
                                        {rg.resources.map((res:Resource) => (
                                            <div key={res.id} className="p-3 border-b last:border-0 hover:bg-yellow-50">
                                                <div className="flex justify-between font-bold text-sm"><div>{res.name} <span className="font-normal text-xs text-gray-500">({res.type})</span></div> {getStatusBadge(res.migrationStatus)}</div>
                                                {res.issues.map((i, idx) => (
                                                    <div key={idx} className="mt-2 text-sm pl-2 border-l-2 border-red-300">
                                                        <div className="font-bold text-red-700">{i.message}</div>
                                                        <div className="text-gray-600">{i.impact}</div>
                                                        <div className="bg-gray-800 text-gray-200 p-2 rounded text-xs font-mono mt-1">FIX: {i.workaround}</div>
                                                        {i.refLink && <a href={i.refLink} target="_blank" className="text-blue-600 text-xs block mt-1 hover:underline">📚 Docs</a>}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>}
                                </div>
                            ))}
                        </div>}
                    </div>
                ))}
            </div>
        )}

        {/* --- VIEW 3: DIAGNOSTICA (TEST) --- */}
        {view === 'test' && (
            <div className="bg-white p-6 rounded shadow border">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">Diagnostica Completa</h2>
                        <p className="text-sm text-gray-500">Verifica coerenza regole (CSV) e validità link (Docs).</p>
                    </div>
                    <button onClick={runDiagnostics} disabled={testLoading} className="bg-purple-600 text-white px-6 py-2 rounded font-bold hover:bg-purple-700">
                        {testLoading ? 'Analisi in corso...' : 'Avvia Test'}
                    </button>
                </div>
                
                {testResult && (
                    <div className="space-y-8 text-left">
                        <div className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
                                <h3 className="font-bold">1. Coerenza Logica (Engine vs CSV)</h3>
                                <div className="text-xs font-mono flex gap-3">
                                    <span className="text-blue-600">Total: {testResult.logic.total}</span>
                                    <span className="text-green-600">Pass: {testResult.logic.passed}</span>
                                    <span className="text-red-600">Fail: {testResult.logic.failed}</span>
                                </div>
                            </div>
                            {testResult.logic.failed > 0 ? (
                                <div className="max-h-60 overflow-y-auto bg-red-50 p-3 text-xs font-mono">
                                    {testResult.logic.failures.map((f:any, i:number) => (
                                        <div key={i} className="mb-2 border-b border-red-200 pb-1">
                                            <div className="font-bold">{f.resource} <span className="text-gray-500">({f.scenario})</span></div>
                                            <div>Expected: <span className="text-green-700">{f.expected}</span> | Got: <span className="text-red-700">{f.got}</span></div>
                                        </div>
                                    ))}
                                </div>
                            ) : <div className="p-4 text-green-600 font-bold bg-green-50">✅ Nessuna discrepanza logica trovata.</div>}
                        </div>

                        <div className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
                                <h3 className="font-bold">2. Integrità Link (HTTP Check)</h3>
                                <div className="text-xs font-mono flex gap-3">
                                    <span className="text-blue-600">Checked: {testResult.links.checked}</span>
                                    <span className="text-red-600">Broken: {testResult.links.broken}</span>
                                </div>
                            </div>
                            {testResult.links.broken > 0 ? (
                                <div className="max-h-60 overflow-y-auto bg-red-50 p-3 text-xs font-mono">
                                    {testResult.links.details.map((l:any, i:number) => (
                                        <div key={i} className="mb-2 border-b border-red-200 pb-1">
                                            <div className="font-bold text-red-700">[{l.status}] {l.ruleId}</div>
                                            <a href={l.url} target="_blank" className="text-blue-600 hover:underline truncate block">{l.url}</a>
                                            <div className="text-gray-400">File: {l.file}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <div className="p-4 text-green-600 font-bold bg-green-50">✅ Tutti i link sono validi.</div>}
                        </div>
                    </div>
                )}
            </div>
        )}

      </div>
    </div>
  );
}

export default App;