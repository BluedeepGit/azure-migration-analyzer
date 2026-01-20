import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info' | 'Ready';

// ... (Le interfacce Resource, Issue, Summary rimangono uguali a prima) ...
interface AuthConfig { useManagedIdentity: boolean; tenantId: string; clientId: string; clientSecret: string; }
interface Subscription { subscriptionId: string; displayName: string; tenantId: string; }
interface ResourceGroup { name: string; subscriptionId: string; location: string; }
interface Resource { id: string; name: string; type: string; resourceGroup: string; subscriptionId: string; subscriptionName?: string; location: string; migrationStatus: Severity; issues: any[]; }
interface Summary { total: number; blockers: number; critical: number; warnings: number; ready: number; downtimeRisks: number; }
interface ApiResponse { scenario: MigrationScenario; summary: Summary; details: Resource[]; targetRegion?: string; }
interface TestResult { passed: number; failed: number; total: number; failures: any[]; }

const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

function App() {
  const [view, setView] = useState<'config' | 'report' | 'test'>('config');
  
  // Config States
  const [auth, setAuth] = useState<AuthConfig>({ useManagedIdentity: true, tenantId: '', clientId: '', clientSecret: '' });
  const [isConnecting, setIsConnecting] = useState(false);
  const [availableSubs, setAvailableSubs] = useState<Subscription[]>([]);
  
  // Selection States
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [scenario, setScenario] = useState<MigrationScenario>('cross-tenant');
  
  // RG & Region Selection (New)
  const [availableRGs, setAvailableRGs] = useState<ResourceGroup[]>([]);
  const [selectedRGs, setSelectedRGs] = useState<string[]>([]); // Lista nomi RG
  const [loadingRGs, setLoadingRGs] = useState(false);
  
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);
  const [targetRegion, setTargetRegion] = useState('');

  // Report Data
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // UI States
  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<string>('All');
  
  // Test
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // --- 1. CONNESSIONE ---
  const connectToAzure = async () => {
    setIsConnecting(true); setError('');
    try {
      const payload = auth.useManagedIdentity ? {} : { auth };
      const res = await axios.post('/api/login', payload);
      setAvailableSubs(res.data.subscriptions);
      // Fetch regions once connected
      const regRes = await axios.get('/api/regions');
      setAvailableRegions(regRes.data);
    } catch (err: any) { setError(err.response?.data?.error || err.message); } 
    finally { setIsConnecting(false); }
  };

  // --- 2. FETCH RESOURCE GROUPS (Al cambio di Sub o Scenario) ---
  useEffect(() => {
    if (availableSubs.length > 0 && selectedSubs.length > 0 && scenario !== 'cross-tenant') {
       fetchResourceGroups();
    } else {
       setAvailableRGs([]);
       setSelectedRGs([]);
    }
  }, [selectedSubs, scenario]);

  const fetchResourceGroups = async () => {
      setLoadingRGs(true);
      try {
          const payload = { auth: auth.useManagedIdentity ? undefined : auth, subscriptions: selectedSubs };
          const res = await axios.post('/api/resource-groups', payload);
          setAvailableRGs(res.data);
          // Auto-select all by default? No, user chooses. Or yes? Let's say select ALL for convenience.
          setSelectedRGs(res.data.map((rg:any) => rg.name));
      } catch (err) { console.error(err); } 
      finally { setLoadingRGs(false); }
  };

  // --- 3. ANALISI ---
  const runAnalysis = async () => {
    if (selectedSubs.length === 0) { setError("Seleziona almeno una sottoscrizione."); return; }
    
    // Validazione specifica scenario
    if (scenario !== 'cross-tenant' && selectedRGs.length === 0) { setError("Seleziona almeno un Resource Group."); return; }
    if (scenario === 'cross-region' && !targetRegion) { setError("Seleziona la Regione di destinazione."); return; }

    setLoading(true); setError(''); setView('report');
    
    try {
      const payload = {
        scenario,
        subscriptions: selectedSubs,
        resourceGroups: scenario === 'cross-tenant' ? undefined : selectedRGs, // Cross-tenant prende tutto
        targetRegion: scenario === 'cross-region' ? targetRegion : undefined,
        auth: auth.useManagedIdentity ? undefined : auth
      };
      const response = await axios.post('/api/analyze', payload);
      setData(response.data);
      expandAll(true, response.data.details);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      setView('config'); 
    } finally { setLoading(false); }
  };

  // --- HELPER UI ---
  const handleSubToggle = (subId: string) => {
    setSelectedSubs(prev => prev.includes(subId) ? prev.filter(s => s !== subId) : [...prev, subId]);
  };
  
  const handleRGToggle = (rgName: string) => {
    setSelectedRGs(prev => prev.includes(rgName) ? prev.filter(r => r !== rgName) : [...prev, rgName]);
  };

  const expandAll = (expand: boolean, resources: Resource[] = []) => {
      /* ... logica expand esistente ... */
      const newExpS: any = {}; const newExpG: any = {};
      (resources.length ? resources : data?.details || []).forEach(r => {
          newExpS[r.subscriptionId] = expand;
          newExpG[`${r.subscriptionId}-${r.resourceGroup}`] = expand;
      });
      setExpandedSubs(newExpS); setExpandedGroups(newExpG);
  };
  
  // ... groupedData logic (identica alla versione precedente) ...
  const groupedData = useMemo(() => {
    if (!data) return [];
    const filtered = data.details.filter(r => filterStatus === 'All' || (filterStatus === 'Downtime' ? r.issues.some(i => i.downtimeRisk) : r.migrationStatus === filterStatus));
    const tree: any = {};
    filtered.forEach(res => {
      let subName = res.subscriptionName;
      if (!subName) subName = availableSubs.find(s => s.subscriptionId === res.subscriptionId)?.displayName || res.subscriptionId;
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

  // Helper Badge (identico)
  const getStatusBadge = (status: string) => {
     const c = status === 'Blocker' ? 'bg-red-800 text-white' : status === 'Critical' ? 'bg-red-100 text-red-800' : status === 'Warning' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800';
     return <span className={`px-2 py-0.5 rounded text-xs font-bold border ${c}`}>{status}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans text-gray-900">
      
      {/* HEADER SEMPLIFICATO */}
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center sticky top-0 z-50">
         <h1 className="font-bold text-lg text-blue-700">Azure Migration Console</h1>
         <div className="flex gap-2">
            <button onClick={() => setView('config')} className={`px-3 py-1 rounded ${view==='config'?'bg-blue-100':''}`}>Config</button>
            <button onClick={() => setView('report')} disabled={!data} className={`px-3 py-1 rounded ${view==='report'?'bg-blue-100':''}`}>Report</button>
         </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        
        {/* --- CONFIGURAZIONE --- */}
        {view === 'config' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* 1. AUTH & SUB SELECTION */}
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-white p-5 rounded shadow-sm border">
                    <h2 className="font-bold mb-3">1. Accesso</h2>
                    {availableSubs.length === 0 ? (
                        <>
                            <div className="mb-3">
                                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auth.useManagedIdentity} onChange={e => setAuth({...auth, useManagedIdentity: e.target.checked})} /> Managed Identity</label>
                            </div>
                            {!auth.useManagedIdentity && (
                                <div className="space-y-2 mb-3">
                                    <input className="w-full border p-2 text-sm rounded" placeholder="Tenant ID" value={auth.tenantId} onChange={e => setAuth({...auth, tenantId: e.target.value})} />
                                    <input className="w-full border p-2 text-sm rounded" placeholder="Client ID" value={auth.clientId} onChange={e => setAuth({...auth, clientId: e.target.value})} />
                                    <input className="w-full border p-2 text-sm rounded" type="password" placeholder="Secret" value={auth.clientSecret} onChange={e => setAuth({...auth, clientSecret: e.target.value})} />
                                </div>
                            )}
                            <button onClick={connectToAzure} disabled={isConnecting} className="w-full bg-blue-600 text-white py-2 rounded text-sm font-bold">{isConnecting ? '...' : 'Connetti'}</button>
                            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
                        </>
                    ) : (
                        <div className="text-sm text-green-600 font-bold mb-2">✓ Connesso ({availableSubs.length} sub)</div>
                    )}

                    {availableSubs.length > 0 && (
                        <div className="max-h-60 overflow-y-auto border rounded mt-2">
                            {availableSubs.map(s => (
                                <div key={s.subscriptionId} className="flex items-center p-2 hover:bg-gray-50 border-b">
                                    <input type="checkbox" checked={selectedSubs.includes(s.subscriptionId)} onChange={() => handleSubToggle(s.subscriptionId)} />
                                    <div className="ml-2 text-xs">
                                        <div className="font-bold">{s.displayName}</div>
                                        <div className="text-gray-500">{s.subscriptionId}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 2. SCENARIO & FILTRI */}
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-5 rounded shadow-sm border">
                    <h2 className="font-bold mb-4">2. Scenario di Migrazione</h2>
                    
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        {['cross-tenant', 'cross-subscription', 'cross-resourcegroup', 'cross-region'].map(s => (
                            <div key={s} 
                                onClick={() => setScenario(s as any)}
                                className={`p-4 border rounded cursor-pointer transition-all ${scenario === s ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'hover:border-gray-400'}`}
                            >
                                <div className="font-bold text-gray-800 capitalize">{s.replace('cross-', '').replace('-', ' to ')}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {s === 'cross-tenant' ? 'Sposta intera sottoscrizione (All Resources).' : 
                                     s === 'cross-region' ? 'Richiede selezione target region.' : 'Sposta risorse specifiche.'}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* SELEZIONE RESOURCE GROUPS (Solo se non è Tenant Move) */}
                    {scenario !== 'cross-tenant' && (
                        <div className="mb-6 animate-fade-in">
                            <div className="flex justify-between items-end mb-2">
                                <label className="text-sm font-bold text-gray-700">Seleziona Resource Groups</label>
                                <button onClick={() => setSelectedRGs(availableRGs.map(r => r.name))} className="text-xs text-blue-600 hover:underline">Select All</button>
                            </div>
                            
                            {loadingRGs ? (
                                <div className="text-sm text-gray-400 italic">Caricamento RG...</div>
                            ) : availableRGs.length === 0 ? (
                                <div className="text-sm text-gray-400 italic border p-4 rounded text-center">Seleziona una sottoscrizione per vedere i RG.</div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto border p-2 rounded bg-gray-50">
                                    {availableRGs.map(rg => (
                                        <label key={rg.name} className="flex items-center gap-2 p-1 hover:bg-white rounded cursor-pointer">
                                            <input type="checkbox" checked={selectedRGs.includes(rg.name)} onChange={() => handleRGToggle(rg.name)} />
                                            <span className="text-xs truncate" title={rg.name}>{rg.name}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* SELEZIONE REGION (Solo se Region Move) */}
                    {scenario === 'cross-region' && (
                        <div className="mb-6 animate-fade-in">
                            <label className="text-sm font-bold text-gray-700">Regione di Destinazione</label>
                            <select value={targetRegion} onChange={e => setTargetRegion(e.target.value)} className="w-full border p-2 rounded mt-1">
                                <option value="">-- Seleziona --</option>
                                {availableRegions.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">Il report verificherà se i servizi sono disponibili nella regione target.</p>
                        </div>
                    )}

                    <button 
                        onClick={runAnalysis} 
                        disabled={loading || selectedSubs.length === 0}
                        className="w-full bg-blue-700 text-white py-4 rounded-lg font-bold text-lg hover:bg-blue-800 disabled:opacity-50 shadow-lg"
                    >
                        {loading ? 'Analisi in Corso...' : 'AVVIA ANALISI COMPLETA'}
                    </button>
                </div>
            </div>
          </div>
        )}

        {/* --- VISTA REPORT (Identica a prima con dati raggruppati) --- */}
        {view === 'report' && data && (
            <div className="animate-fade-in">
                 {/* ... (Inserisci qui il codice del report precedente, con i gruppi Sub/RG) ... */}
                 {/* Per brevità, ri-incollo solo la struttura essenziale del render */}
                 <div className="space-y-4">
                    {/* KPI */}
                    <div className="flex gap-2 mb-4 overflow-x-auto">
                        <div className="bg-white p-3 border rounded shadow-sm flex-1"><div className="text-xs text-gray-500">TOTAL</div><div className="font-bold text-xl">{data.summary.total}</div></div>
                        <div className="bg-red-50 p-3 border border-red-200 rounded shadow-sm flex-1"><div className="text-xs text-red-500">BLOCKERS</div><div className="font-bold text-xl text-red-700">{data.summary.blockers}</div></div>
                        <div className="bg-green-50 p-3 border border-green-200 rounded shadow-sm flex-1"><div className="text-xs text-green-500">READY</div><div className="font-bold text-xl text-green-700">{data.summary.ready}</div></div>
                    </div>

                    {groupedData.map((subNode: any) => (
                        <div key={subNode.id} className="bg-white border rounded shadow-sm">
                            <div onClick={() => setExpandedSubs({...expandedSubs, [subNode.id]: !expandedSubs[subNode.id]})} className="bg-gray-100 p-3 flex justify-between cursor-pointer font-bold">
                                <div>{subNode.name} <span className="text-gray-400 font-normal text-xs">({subNode.id})</span></div>
                                {getStatusBadge(subNode.worstStatus)}
                            </div>
                            {expandedSubs[subNode.id] && (
                                <div className="p-3 bg-gray-50 space-y-3">
                                    {subNode.groupList.map((rg:any) => (
                                        <div key={rg.name} className="bg-white border rounded">
                                            <div onClick={() => setExpandedGroups({...expandedGroups, [`${subNode.id}-${rg.name}`]: !expandedGroups[`${subNode.id}-${rg.name}`]})} className="p-2 flex justify-between cursor-pointer hover:bg-blue-50">
                                                <div className="text-sm font-bold text-gray-700">RG: {rg.name} ({rg.resources.length})</div>
                                                {getStatusBadge(rg.worstStatus)}
                                            </div>
                                            {expandedGroups[`${subNode.id}-${rg.name}`] && (
                                                <div className="border-t">
                                                    {rg.resources.map((res:any) => (
                                                        <div key={res.id} className="p-2 border-b text-sm flex gap-2">
                                                            <div className="w-1/3 font-bold">{res.name}<br/><span className="font-normal text-xs text-gray-500">{res.type}</span></div>
                                                            <div className="flex-1">
                                                                {res.issues.length > 0 ? res.issues.map((i:any, k:number) => <div key={k} className="text-red-700 text-xs mb-1">• {i.message}</div>) : <span className="text-green-600 text-xs">OK</span>}
                                                            </div>
                                                            <div>{getStatusBadge(res.migrationStatus)}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                 </div>
            </div>
        )}
      </div>
    </div>
  );
}

export default App;