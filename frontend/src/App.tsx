import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { pdf } from '@react-pdf/renderer'; // Import per PDF
import { MigrationReport } from './ReportTemplate'; // Import Template PDF

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
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false); // Stato PDF
  
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

  const handleDownloadPdf = async () => {
    if (!data) return;
    setIsGeneratingPdf(true);
    try {
      const blob = await pdf(<MigrationReport data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Azure_Migration_Report_${new Date().toISOString().slice(0,10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) { console.error(err); alert("Errore PDF"); }
    finally { setIsGeneratingPdf(false); }
  };

  // --- UI HELPER ---
  const handleSubToggle = (id: string) => setSelectedSubs(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  const handleRGToggle = (name: string) => setSelectedRGs(prev => prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name]);

  const toggleExpandAll = (expand: boolean, resourcesSource?: Resource[]) => {
      const resources = resourcesSource || data?.details || [];
      const newExpSubs: Record<string, boolean> = {};
      const newExpGroups: Record<string, boolean> = {};
      resources.forEach(r => {
          newExpSubs[r.subscriptionId] = expand;
          newExpGroups[`${r.subscriptionId}-${r.resourceGroup}`] = expand;
      });
      setExpandedSubs(newExpSubs); setExpandedGroups(newExpGroups);
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
      let subName = res.subscriptionName;
      if (!subName || subName === res.subscriptionId) {
          subName = availableSubs.find(s => s.subscriptionId === res.subscriptionId)?.displayName || res.subscriptionId;
      }
      if (!tree[res.subscriptionId]) tree[res.subscriptionId] = { id: res.subscriptionId, name: subName, groups: {}, worstStatus: 'Ready' };
      const subNode = tree[res.subscriptionId];
      const rgName = res.resourceGroup || "No-RG";
      if (!subNode.groups[rgName]) subNode.groups[rgName] = [];
      subNode.groups[rgName].push(res);
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
            <button onClick={() => setView('config')} className={`px-4 py-2 text-sm font-bold rounded transition-colors ${view==='config' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>Config</button>
            <button onClick={() => setView('report')} disabled={!data} className={`px-4 py-2 text-sm font-bold rounded transition-colors ${view==='report' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100 disabled:opacity-50'}`}>Report</button>
            
            {/* BOTTONE PDF */}
            {data && (
                <button onClick={handleDownloadPdf} disabled={isGeneratingPdf} className="px-4 py-2 text-sm font-bold rounded transition-colors bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 flex items-center gap-2">
                    {isGeneratingPdf ? '...' : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>PDF</>}
                </button>
            )}

            <button onClick={() => setView('test')} className={`px-4 py-2 text-sm font-bold rounded transition-colors border-2 ${view==='test' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'text-purple-600 border-purple-100 hover:bg-purple-50'}`}>Diagnostica</button>
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
                         <div className="flex justify-between items-end mb-2"><label className="text-sm font-bold">Resource Groups</label><div className="space-x-2 text-xs"><button onClick={() => setSelectedRGs(availableRGs.map(r=>r.name))} className="text-blue-600 hover:underline">Select All</button> <button onClick={() => setSelectedRGs([])} className="text-red-600 hover:underline">Deselect All</button></div></div>
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
                    {[
                        { label: 'Total', value: data.summary.total, color: 'blue' },
                        { label: 'Blockers', value: data.summary.blockers, color: 'red', filter: 'Blocker' },
                        { label: 'Critical', value: data.summary.critical, color: 'red', filter: 'Critical' },
                        { label: 'Warnings', value: data.summary.warnings, color: 'orange', filter: 'Warning' },
                        { label: 'Ready', value: data.summary.ready, color: 'green', filter: 'Ready' }
                    ].map(kpi => (
                        <div key={kpi.label} onClick={() => kpi.filter && setFilterStatus(kpi.filter)} className={`bg-white p-4 rounded border-l-4 border-${kpi.color}-500 shadow-sm flex-1 cursor-pointer hover:bg-gray-50 transition-transform active:scale-95`}>
                            <div className="text-xs text-gray-500 uppercase font-bold">{kpi.label}</div>
                            <div className={`text-2xl font-bold text-${kpi.color}-700`}>{kpi.value !== undefined ? kpi.value : 0}</div>
                        </div>
                    ))}
                </div>
                
                <div className="flex justify-between items-center bg-gray-100 p-3 rounded-lg border border-gray-200">
                    <div className="text-sm font-bold text-gray-600">
                        Filtro attivo: <span className="text-blue-700">{filterStatus}</span> | Scenario: {data.scenario}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => toggleExpandAll(true)} className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-50 shadow-sm">Expand All</button>
                        <button onClick={() => toggleExpandAll(false)} className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-50 shadow-sm">Collapse All</button>
                    </div>
                </div>

                {groupedData.map((sub:any) => (
                    <div key={sub.id} className="bg-white border rounded shadow-sm overflow-hidden">
                        <div onClick={() => setExpandedSubs({...expandedSubs, [sub.id]: !expandedSubs[sub.id]})} className="bg-gray-100 px-4 py-4 flex justify-between items-center cursor-pointer hover:bg-white transition-colors border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-yellow-100 rounded-lg text-yellow-700 border border-yellow-200"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg></div>
                                <div><div className="font-bold text-gray-900 text-xl">{sub.name}</div><div className="text-xs text-gray-500 font-mono">ID: {sub.id}</div></div>
                            </div>
                            <div className="flex items-center gap-4">{getStatusBadge(sub.worstStatus)} <svg className={`w-5 h-5 text-gray-400 transition-transform ${expandedSubs[sub.id] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></div>
                        </div>
                        {expandedSubs[sub.id] && <div className="p-4 bg-gray-50 space-y-4">
                            {sub.groupList.map((rg:any) => (
                                <div key={rg.name} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                    <div onClick={() => setExpandedGroups(p => ({...p, [`${sub.id}-${rg.name}`]: !p[`${sub.id}-${rg.name}`]}))} className="px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-blue-50 transition-colors">
                                        <div className="font-bold text-sm text-gray-700 flex items-center gap-2"><span className="text-[10px] bg-gray-200 px-1.5 py-0.5 rounded text-gray-600 border border-gray-300">RG</span> {rg.name} <span className="text-gray-400 text-xs font-normal">({rg.resources.length})</span></div>
                                        {getStatusBadge(rg.worstStatus)}
                                    </div>
                                    {expandedGroups[`${sub.id}-${rg.name}`] && <div className="border-t border-gray-100">
                                        {rg.resources.map((res:Resource) => (
                                            <div key={res.id} className="p-4 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div><div className="font-bold text-gray-800">{res.name}</div><div className="text-xs text-gray-500 font-mono mt-0.5">{res.type}</div><div className="text-[10px] text-gray-400 mt-1">{res.location}</div></div>
                                                    <div className="flex flex-col items-end gap-1">{getStatusBadge(res.migrationStatus)}{res.issues.some(i => i.downtimeRisk) && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded border border-purple-200 flex items-center gap-1">⚡ Downtime</span>}</div>
                                                </div>
                                                {res.issues.length > 0 ? (
                                                    <div className="space-y-3 mt-3 pl-3 border-l-4 border-red-100">
                                                        {res.issues.map((issue, idx) => (
                                                            <div key={idx} className="text-sm">
                                                                <div className="flex items-center gap-2 text-red-700 font-bold mb-1">⚠️ {issue.message}</div>
                                                                <div className="text-gray-700 mb-2"><span className="font-bold text-xs uppercase">Impatto:</span> {issue.impact}</div>
                                                                <div className="bg-slate-800 text-slate-200 p-2.5 rounded text-xs font-mono shadow-inner"><span className="text-green-400 font-bold">$ FIX: </span>{issue.workaround}</div>
                                                                {issue.refLink && <a href={issue.refLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:underline">📚 Documentazione</a>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : <div className="text-xs text-green-600 flex items-center gap-1 mt-2 bg-green-50 p-2 rounded w-fit">✅ Pronto</div>}
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
                        {/* Sezione 1: Logic Test */}
                        <div className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b font-bold flex justify-between">
                                <span>1. Coerenza Logica (Engine vs CSV)</span>
                                <div className="text-xs font-mono flex gap-3">
                                    <span className="text-blue-600">Total: {testResult.logic.total}</span>
                                    <span className="text-green-600">Pass: {testResult.logic.passed}</span>
                                    <span className={`font-bold ${testResult.logic.failed > 0 ? 'text-red-600' : 'text-gray-400'}`}>Fail: {testResult.logic.failed}</span>
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

                        {/* Sezione 2: Link Health (DETTAGLIATA) */}
                        <div className="border rounded-lg overflow-hidden border-gray-200">
                            <div className="bg-gray-50 px-4 py-3 border-b font-bold flex justify-between">
                                <span>2. Integrità Link (HTTP Check)</span>
                                <div className="text-xs font-mono flex gap-3">
                                    <span className="text-blue-600">Checked: {testResult.links.checked}</span>
                                    <span className={`font-bold ${testResult.links.broken > 0 ? 'text-red-600' : 'text-gray-400'}`}>Broken: {testResult.links.broken}</span>
                                </div>
                            </div>
                            {testResult.links.broken > 0 ? (
                                <div className="max-h-[500px] overflow-y-auto bg-white">
                                    {testResult.links.details.map((l:any, i:number) => (
                                        <div key={i} className="p-3 border-b border-red-100 bg-red-50 flex flex-col gap-1 hover:bg-red-100 transition-colors">
                                            <div className="flex justify-between items-center text-xs text-gray-500 font-mono mb-1">
                                                <span>FILE: <span className="font-bold text-gray-800">{l.file}</span></span>
                                                <span className="bg-white px-2 py-0.5 rounded border">ID: <span className="font-bold text-black">{l.ruleId}</span></span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase min-w-[40px] text-center">
                                                    {l.status}
                                                </span>
                                                <a href={l.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm truncate font-medium block flex-1">
                                                    {l.url}
                                                </a>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : <div className="p-4 text-green-600 font-bold bg-green-50">✅ Tutti i link sono validi e raggiungibili.</div>}
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