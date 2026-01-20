import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info' | 'Ready';

interface AuthConfig { useManagedIdentity: boolean; tenantId: string; clientId: string; clientSecret: string; }
interface Subscription { subscriptionId: string; displayName: string; tenantId: string; }
interface ResourceGroup { name: string; subscriptionId: string; location: string; }
interface Region { name: string; displayName: string; } // Nuovo tipo per Region
interface Issue { severity: string; message: string; impact: string; workaround: string; downtimeRisk: boolean; refLink?: string; }
interface Resource { id: string; name: string; type: string; resourceGroup: string; subscriptionId: string; subscriptionName?: string; location: string; migrationStatus: Severity; issues: Issue[]; }
interface Summary { total: number; blockers: number; critical: number; warnings: number; ready: number; downtimeRisks: number; }
interface ApiResponse { scenario: MigrationScenario; summary: Summary; details: Resource[]; targetRegion?: string; }
interface TestResult { passed: number; failed: number; total: number; failures: any[]; }

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

  // Data & UI
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<string>('All');
  
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // --- ACTIONS ---

  const connectToAzure = async () => {
    setIsConnecting(true); setError('');
    try {
      const payload = auth.useManagedIdentity ? {} : { auth };
      const res = await axios.post('/api/login', payload);
      setAvailableSubs(res.data.subscriptions);
      // Pre-select first sub if any
      if(res.data.subscriptions.length > 0) setSelectedSubs([res.data.subscriptions[0].subscriptionId]);
    } catch (err: any) { setError(err.response?.data?.error || err.message); } 
    finally { setIsConnecting(false); }
  };

  // Fetch Regions dinamico (quando cambiano le sub selezionate)
  useEffect(() => {
      if (selectedSubs.length > 0) {
        // Fetch Regions usando la prima sub selezionata
        axios.post('/api/regions', { auth: auth.useManagedIdentity ? undefined : auth, subscriptionId: selectedSubs[0] })
             .then(res => setAvailableRegions(res.data))
             .catch(console.error);
      }
  }, [selectedSubs]);

  // Fetch RGs
  useEffect(() => {
    if (availableSubs.length > 0 && selectedSubs.length > 0 && scenario !== 'cross-tenant') {
       fetchResourceGroups();
    } else {
       setAvailableRGs([]); setSelectedRGs([]);
    }
  }, [selectedSubs, scenario]);

  const fetchResourceGroups = async () => {
      setLoadingRGs(true);
      try {
          const payload = { auth: auth.useManagedIdentity ? undefined : auth, subscriptions: selectedSubs };
          const res = await axios.post('/api/resource-groups', payload);
          setAvailableRGs(res.data);
          setSelectedRGs(res.data.map((rg:any) => rg.name)); // Select All default
      } catch (err) { console.error(err); } 
      finally { setLoadingRGs(false); }
  };

  const runAnalysis = async () => {
    if (selectedSubs.length === 0) { setError("Seleziona almeno una sottoscrizione."); return; }
    if (scenario !== 'cross-tenant' && selectedRGs.length === 0) { setError("Seleziona almeno un Resource Group."); return; }
    if (scenario === 'cross-region' && !targetRegion) { setError("Seleziona la Regione di destinazione."); return; }

    setLoading(true); setError(''); setView('report');
    try {
      const payload = {
        scenario, subscriptions: selectedSubs, resourceGroups: scenario === 'cross-tenant' ? undefined : selectedRGs,
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

  const runDiagnostics = async () => { /* ... existing test logic ... */ 
      // (Omitted for brevity, paste existing logic here)
      axios.get('/api/admin/run-test').then(r => setTestResult(r.data)).catch(e => alert(e.message));
  };

  // --- UI HELPERS ---
  const handleSubToggle = (id: string) => setSelectedSubs(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  const handleRGToggle = (name: string) => setSelectedRGs(prev => prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name]);
  
  const expandAll = (expand: boolean, resources: Resource[] = []) => {
      const newExpS: any = {}; const newExpG: any = {};
      (resources.length ? resources : data?.details || []).forEach(r => {
          newExpS[r.subscriptionId] = expand;
          newExpG[`${r.subscriptionId}-${r.resourceGroup}`] = expand;
      });
      setExpandedSubs(newExpS); setExpandedGroups(newExpG);
  };

  const groupedData = useMemo(() => {
    // ... (Existing Grouping Logic - Copy form previous step) ...
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

  const getStatusBadge = (status: string) => {
     const styles: any = { 'Blocker': 'bg-red-800 text-white', 'Critical': 'bg-red-100 text-red-800', 'Warning': 'bg-orange-100 text-orange-800', 'Info': 'bg-blue-100 text-blue-800', 'Ready': 'bg-green-100 text-green-800' };
     return <span className={`px-2 py-0.5 rounded text-xs font-bold border ${styles[status]}`}>{status}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans text-gray-900">
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
         <h1 className="font-bold text-lg text-blue-700">Azure Migration Console</h1>
         <div className="flex gap-2">
            <button onClick={() => setView('config')} className={`px-3 py-1 rounded ${view==='config'?'bg-blue-100':''}`}>Config</button>
            <button onClick={() => setView('report')} disabled={!data} className={`px-3 py-1 rounded ${view==='report'?'bg-blue-100':''}`}>Report</button>
         </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        
        {view === 'config' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white p-5 rounded shadow-sm border">
                <h2 className="font-bold mb-3">1. Accesso</h2>
                <div className="mb-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auth.useManagedIdentity} onChange={e => setAuth({...auth, useManagedIdentity: e.target.checked})} /> Managed Identity</label></div>
                {!auth.useManagedIdentity && <div className="space-y-2 mb-3"><input className="w-full border p-2 text-sm rounded" placeholder="Tenant ID" value={auth.tenantId} onChange={e => setAuth({...auth, tenantId: e.target.value})} /><input className="w-full border p-2 text-sm rounded" placeholder="Client ID" value={auth.clientId} onChange={e => setAuth({...auth, clientId: e.target.value})} /><input className="w-full border p-2 text-sm rounded" type="password" placeholder="Secret" value={auth.clientSecret} onChange={e => setAuth({...auth, clientSecret: e.target.value})} /></div>}
                <button onClick={connectToAzure} disabled={isConnecting} className="w-full bg-blue-600 text-white py-2 rounded text-sm font-bold">{isConnecting ? '...' : 'Connetti'}</button>
                {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
                
                {availableSubs.length > 0 && (
                    <div className="mt-4">
                         <div className="font-bold text-sm mb-1">Sottoscrizioni ({availableSubs.length})</div>
                         <div className="max-h-60 overflow-y-auto border rounded bg-gray-50">
                            {availableSubs.map(s => (
                                <div key={s.subscriptionId} className="flex items-center p-2 hover:bg-white border-b">
                                    <input type="checkbox" checked={selectedSubs.includes(s.subscriptionId)} onChange={() => handleSubToggle(s.subscriptionId)} />
                                    <div className="ml-2 text-xs truncate" title={s.displayName}>{s.displayName}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="lg:col-span-2 bg-white p-5 rounded shadow-sm border">
                <h2 className="font-bold mb-4">2. Scenario</h2>
                <div className="grid grid-cols-2 gap-4 mb-6">
                    {['cross-tenant', 'cross-subscription', 'cross-resourcegroup', 'cross-region'].map(s => (
                        <div key={s} onClick={() => setScenario(s as any)} className={`p-4 border rounded cursor-pointer ${scenario === s ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'hover:border-gray-400'}`}>
                            <div className="font-bold capitalize">{s.replace('cross-', '').replace('-', ' to ')}</div>
                        </div>
                    ))}
                </div>

                {scenario !== 'cross-tenant' && (
                    <div className="mb-6 animate-fade-in">
                        <div className="flex justify-between items-end mb-2">
                            <label className="text-sm font-bold text-gray-700">Seleziona Resource Groups</label>
                            <div className="space-x-2">
                                <button onClick={() => setSelectedRGs(availableRGs.map(r => r.name))} className="text-xs text-blue-600 hover:underline">Select All</button>
                                <span className="text-gray-300">|</span>
                                <button onClick={() => setSelectedRGs([])} className="text-xs text-red-600 hover:underline">Deselect All</button>
                            </div>
                        </div>
                        {loadingRGs ? <div className="text-sm text-gray-400 italic">Caricamento RG...</div> : (
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

                {scenario === 'cross-region' && (
                    <div className="mb-6">
                        <label className="text-sm font-bold text-gray-700">Regione Target</label>
                        <select value={targetRegion} onChange={e => setTargetRegion(e.target.value)} className="w-full border p-2 rounded mt-1">
                            <option value="">-- Seleziona --</option>
                            {availableRegions.map(r => <option key={r.name} value={r.name}>{r.displayName} ({r.name})</option>)}
                        </select>
                    </div>
                )}

                <button onClick={runAnalysis} disabled={loading || selectedSubs.length === 0} className="w-full bg-green-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-green-700 disabled:opacity-50">
                    {loading ? 'Analisi in Corso...' : 'AVVIA ANALISI'}
                </button>
            </div>
          </div>
        )}

        {view === 'report' && data && (
           <div className="animate-fade-in space-y-6">
               <div className="flex gap-4 overflow-x-auto pb-2">
                  {/* KPI BOXES */}
                  {[
                     {l:'Total',v:data.summary.total,c:'blue'}, {l:'Blockers',v:data.summary.blockers,c:'red',s:'Blocker'},
                     {l:'Critical',v:data.summary.critical,c:'red',s:'Critical'}, {l:'Warnings',v:data.summary.warnings,c:'orange',s:'Warning'},
                     {l:'Ready',v:data.summary.ready,c:'green',s:'Ready'}
                  ].map(k => (
                      <div key={k.l} onClick={() => k.s && setFilterStatus(k.s)} className={`bg-white p-4 rounded border-l-4 border-${k.c}-500 shadow-sm flex-1 cursor-pointer hover:bg-gray-50`}>
                          <div className="text-xs text-gray-500 font-bold uppercase">{k.l}</div>
                          <div className={`text-2xl font-bold text-${k.c}-700`}>{k.v}</div>
                      </div>
                  ))}
               </div>

               {groupedData.map((subNode:any) => (
                  <div key={subNode.id} className="bg-white border rounded shadow-sm overflow-hidden">
                      <div onClick={() => setExpandedSubs({...expandedSubs, [subNode.id]: !expandedSubs[subNode.id]})} className="bg-gray-100 p-4 flex justify-between items-center cursor-pointer hover:bg-gray-200">
                          <div className="flex items-center gap-3">
                              <div className="p-1.5 bg-yellow-200 rounded text-yellow-800"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg></div>
                              <div>
                                  <div className="font-bold text-gray-900 text-lg">{subNode.name}</div>
                                  <div className="text-xs text-gray-500 font-mono">{subNode.id}</div>
                              </div>
                          </div>
                          <div className="flex items-center gap-4">{getStatusBadge(subNode.worstStatus)}</div>
                      </div>

                      {expandedSubs[subNode.id] && (
                          <div className="p-4 bg-gray-50 space-y-4">
                              {subNode.groupList.map((rg:any) => (
                                  <div key={rg.name} className="bg-white border rounded overflow-hidden">
                                      <div onClick={() => setExpandedGroups({...expandedGroups, [`${subNode.id}-${rg.name}`]: !expandedGroups[`${subNode.id}-${rg.name}`]})} className="px-4 py-2 flex justify-between items-center cursor-pointer hover:bg-blue-50">
                                          <div className="font-bold text-sm text-gray-700 flex items-center gap-2">
                                              <span className="text-[10px] bg-gray-200 px-1 rounded text-gray-600">RG</span> {rg.name} <span className="text-gray-400 text-xs font-normal">({rg.resources.length})</span>
                                          </div>
                                          {getStatusBadge(rg.worstStatus)}
                                      </div>
                                      
                                      {expandedGroups[`${subNode.id}-${rg.name}`] && (
                                          <div className="border-t">
                                              {rg.resources.map((res:Resource) => (
                                                  <div key={res.id} className="p-4 border-b last:border-0 hover:bg-gray-50">
                                                      <div className="flex justify-between items-start mb-2">
                                                          <div>
                                                              <div className="font-bold text-gray-800">{res.name}</div>
                                                              <div className="text-xs text-gray-500 font-mono mt-0.5">{res.type}</div>
                                                              <div className="text-[10px] text-gray-400 mt-1">{res.location}</div>
                                                          </div>
                                                          {getStatusBadge(res.migrationStatus)}
                                                      </div>
                                                      
                                                      {/* RICH DETAILS AREA */}
                                                      {res.issues.length > 0 ? (
                                                          <div className="space-y-3 mt-3 pl-3 border-l-4 border-red-100">
                                                              {res.issues.map((issue, idx) => (
                                                                  <div key={idx} className="text-sm">
                                                                      <div className="flex items-center gap-2 text-red-700 font-bold mb-1">
                                                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                                          {issue.message}
                                                                      </div>
                                                                      <div className="text-gray-700 mb-2">{issue.impact}</div>
                                                                      
                                                                      <div className="bg-slate-800 text-slate-200 p-3 rounded text-xs font-mono shadow-inner">
                                                                          <span className="text-green-400 font-bold select-none">$ FIX: </span>
                                                                          {issue.workaround}
                                                                      </div>

                                                                      {issue.refLink && (
                                                                          <a href={issue.refLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:underline">
                                                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                                              Documentazione Ufficiale
                                                                          </a>
                                                                      )}
                                                                  </div>
                                                              ))}
                                                          </div>
                                                      ) : (
                                                          <div className="text-xs text-green-600 flex items-center gap-1 mt-2 bg-green-50 p-2 rounded w-fit">
                                                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                              Pronto per la migrazione
                                                          </div>
                                                      )}
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
        )}

      </div>
    </div>
  );
}

export default App;