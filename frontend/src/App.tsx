import { useState, useMemo } from 'react';
import axios from 'axios';

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info' | 'Ready';

interface AuthConfig {
  useManagedIdentity: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

interface Subscription {
  subscriptionId: string;
  displayName: string;
  tenantId: string;
}

interface Resource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  subscriptionId: string; // Nuovo campo
  location: string;
  migrationStatus: Severity;
  issues: any[];
}

interface Summary {
  total: number;
  blockers: number;
  critical: number;
  warnings: number;
  ready: number;
  downtimeRisks: number;
}

// --- HELPER SEVERITY ---
const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

function App() {
  // --- STATI APPLICAZIONE ---
  const [view, setView] = useState<'config' | 'report' | 'test'>('config');
  
  // Auth & Config
  const [auth, setAuth] = useState<AuthConfig>({ useManagedIdentity: true, tenantId: '', clientId: '', clientSecret: '' });
  const [availableSubs, setAvailableSubs] = useState<Subscription[]>([]);
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  // Report Data
  const [scenario, setScenario] = useState<MigrationScenario>('cross-tenant');
  const [data, setData] = useState<{ summary: Summary, details: Resource[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // UI Controls
  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<string>('All');

  // Test Data
  const [testResult, setTestResult] = useState<any>(null);

  // --- AZIONI ---

  // 1. Connessione e Recupero Sottoscrizioni
  const connectToAzure = async () => {
    setIsConnecting(true);
    setError('');
    try {
      const payload = auth.useManagedIdentity ? {} : { auth };
      const res = await axios.post('/api/login', payload);
      setAvailableSubs(res.data.subscriptions);
      // Seleziona tutte di default
      setSelectedSubs(res.data.subscriptions.map((s: any) => s.subscriptionId));
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // 2. Analisi Risorse
  const runAnalysis = async () => {
    if (selectedSubs.length === 0) {
      setError("Seleziona almeno una sottoscrizione.");
      return;
    }
    setLoading(true);
    setError('');
    setView('report');
    
    try {
      const payload = {
        scenario,
        subscriptions: selectedSubs,
        auth: auth.useManagedIdentity ? undefined : auth
      };
      const response = await axios.post('/api/analyze', payload);
      setData(response.data);
      // Espandi tutto di default
      expandAll(true, response.data.details);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      setView('config'); // Torna alla config in caso di errore
    } finally {
      setLoading(false);
    }
  };

  // 3. Esegui Integration Test
  const runTest = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admin/run-test');
      setTestResult(res.data);
    } catch (err: any) { alert(err.message); } 
    finally { setLoading(false); }
  };

  // --- LOGICA UI ---

  const handleSubToggle = (subId: string) => {
    if (selectedSubs.includes(subId)) setSelectedSubs(selectedSubs.filter(s => s !== subId));
    else setSelectedSubs([...selectedSubs, subId]);
  };

  const expandAll = (expand: boolean, resources: Resource[] = []) => {
    const newExpandedSubs: Record<string, boolean> = {};
    const newExpandedGroups: Record<string, boolean> = {};
    
    const targetResources = resources.length > 0 ? resources : (data?.details || []);
    
    targetResources.forEach(r => {
      newExpandedSubs[r.subscriptionId] = expand;
      newExpandedGroups[`${r.subscriptionId}-${r.resourceGroup}`] = expand;
    });
    
    setExpandedSubs(newExpandedSubs);
    setExpandedGroups(newExpandedGroups);
  };

  // --- DATA PROCESSING & GROUPING ---
  const groupedData = useMemo(() => {
    if (!data) return [];
    
    // 1. Filtra
    const filtered = data.details.filter(r => 
      filterStatus === 'All' || 
      (filterStatus === 'Downtime' ? r.issues.some(i => i.downtimeRisk) : r.migrationStatus === filterStatus)
    );

    // 2. Raggruppa: Sub -> RG -> Resources
    const tree: Record<string, { meta: Subscription, groups: Record<string, Resource[]>, worstStatus: Severity }> = {};

    filtered.forEach(res => {
      // Trova metadati sub
      const subMeta = availableSubs.find(s => s.subscriptionId === res.subscriptionId) || { subscriptionId: res.subscriptionId, displayName: res.subscriptionId, tenantId: '' };
      
      if (!tree[res.subscriptionId]) {
        tree[res.subscriptionId] = { meta: subMeta, groups: {}, worstStatus: 'Ready' };
      }

      const subNode = tree[res.subscriptionId];
      if (!subNode.groups[res.resourceGroup]) subNode.groups[res.resourceGroup] = [];
      
      subNode.groups[res.resourceGroup].push(res);

      // Aggiorna worst status della Sub
      if (SEVERITY_WEIGHT[res.migrationStatus] > SEVERITY_WEIGHT[subNode.worstStatus]) {
        subNode.worstStatus = res.migrationStatus;
      }
    });

    // Converti in array ordinato per render
    return Object.values(tree).map(subNode => {
      const groupList = Object.keys(subNode.groups).map(rgName => {
        const resources = subNode.groups[rgName];
        // Worst status del RG
        let rgWorst = 'Ready';
        resources.forEach(r => {
           if (SEVERITY_WEIGHT[r.migrationStatus] > SEVERITY_WEIGHT[rgWorst]) rgWorst = r.migrationStatus;
        });
        return { name: rgName, resources, worstStatus: rgWorst };
      }).sort((a, b) => SEVERITY_WEIGHT[b.worstStatus as string] - SEVERITY_WEIGHT[a.worstStatus as string]);

      return { ...subNode, groupList };
    }).sort((a, b) => SEVERITY_WEIGHT[b.worstStatus as string] - SEVERITY_WEIGHT[a.worstStatus as string]);

  }, [data, filterStatus, availableSubs]);

  // Helper Badge
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      'Blocker': 'bg-red-800 text-white', 'Critical': 'bg-red-100 text-red-800 border-red-200',
      'Warning': 'bg-orange-100 text-orange-800 border-orange-200', 'Info': 'bg-blue-100 text-blue-800 border-blue-200',
      'Ready': 'bg-green-100 text-green-800 border-green-200'
    };
    return <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${styles[status]}`}>{status}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans text-gray-900">
      
      {/* NAVBAR */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded text-white"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg></div>
          <h1 className="font-bold text-lg text-gray-800">Azure Migration Console</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView('config')} className={`px-4 py-2 text-sm font-medium rounded ${view === 'config' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>Configurazione</button>
          <button onClick={() => {if(data) setView('report')}} disabled={!data} className={`px-4 py-2 text-sm font-medium rounded ${view === 'report' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100 disabled:opacity-50'}`}>Report Analisi</button>
          <button onClick={() => setView('test')} className={`px-4 py-2 text-sm font-medium rounded ${view === 'test' ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>Diagnostica</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        
        {/* --- VISTA CONFIGURAZIONE --- */}
        {view === 'config' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Box 1: Credenziali */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="bg-blue-100 text-blue-700 w-6 h-6 flex items-center justify-center rounded-full text-xs">1</span>
                Autenticazione
              </h2>
              
              <div className="flex items-center mb-4">
                <input type="checkbox" id="mi" checked={auth.useManagedIdentity} onChange={(e) => setAuth({...auth, useManagedIdentity: e.target.checked})} className="h-4 w-4 text-blue-600" />
                <label htmlFor="mi" className="ml-2 text-sm font-medium text-gray-700">Usa Managed Identity (Default)</label>
              </div>

              {!auth.useManagedIdentity && (
                <div className="space-y-3 animate-fade-in">
                  <input type="text" placeholder="Tenant ID" value={auth.tenantId} onChange={(e) => setAuth({...auth, tenantId: e.target.value})} className="w-full border p-2 rounded text-sm" />
                  <input type="text" placeholder="Client ID (App ID)" value={auth.clientId} onChange={(e) => setAuth({...auth, clientId: e.target.value})} className="w-full border p-2 rounded text-sm" />
                  <input type="password" placeholder="Client Secret" value={auth.clientSecret} onChange={(e) => setAuth({...auth, clientSecret: e.target.value})} className="w-full border p-2 rounded text-sm" />
                </div>
              )}

              <button onClick={connectToAzure} disabled={isConnecting} className="mt-4 w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50">
                {isConnecting ? 'Connessione...' : 'Connetti e Trova Sottoscrizioni'}
              </button>
              {error && <div className="mt-3 text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}
            </div>

            {/* Box 2: Selezione Sottoscrizioni */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="bg-blue-100 text-blue-700 w-6 h-6 flex items-center justify-center rounded-full text-xs">2</span>
                Seleziona Target
              </h2>
              
              <div className="flex-1 overflow-y-auto max-h-[300px] border rounded bg-gray-50 p-2 mb-4">
                {availableSubs.length === 0 ? (
                  <div className="text-center text-gray-400 py-10 text-sm">Nessuna sottoscrizione caricata.<br/>Effettua la connessione.</div>
                ) : (
                  availableSubs.map(sub => (
                    <div key={sub.subscriptionId} className="flex items-center p-2 hover:bg-white rounded">
                      <input 
                        type="checkbox" 
                        checked={selectedSubs.includes(sub.subscriptionId)} 
                        onChange={() => handleSubToggle(sub.subscriptionId)}
                        className="h-4 w-4 text-blue-600 rounded"
                      />
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">{sub.displayName}</div>
                        <div className="text-xs text-gray-500 font-mono">{sub.subscriptionId}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mb-4">
                 <label className="text-xs font-bold text-gray-500 uppercase">Scenario di Migrazione</label>
                 <select value={scenario} onChange={(e) => setScenario(e.target.value as any)} className="w-full border p-2 rounded mt-1">
                    <option value="cross-tenant">Tenant to Tenant</option>
                    <option value="cross-subscription">Subscription to Subscription</option>
                    <option value="cross-resourcegroup">Resource Group Move</option>
                    <option value="cross-region">Region to Region</option>
                 </select>
              </div>

              <button 
                onClick={runAnalysis} 
                disabled={selectedSubs.length === 0 || loading} 
                className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 shadow-lg"
              >
                {loading ? 'Analisi in corso...' : `Avvia Analisi (${selectedSubs.length} Sub)`}
              </button>
            </div>
          </div>
        )}

        {/* --- VISTA REPORT --- */}
        {view === 'report' && data && (
          <div className="animate-fade-in">
            {/* KPI */}
            <div className="flex gap-4 mb-6 overflow-x-auto pb-2">
                {[
                   {l:'Total', v: data.summary.total, c:'blue'},
                   {l:'Blockers', v: data.summary.blockers, c:'red', s:'Blocker'},
                   {l:'Critical', v: data.summary.critical, c:'red', s:'Critical'},
                   {l:'Downtime', v: data.summary.downtimeRisks, c:'purple', s:'Downtime'},
                ].map(k => (
                    <div key={k.l} onClick={() => k.s && setFilterStatus(k.s)} className={`flex-1 bg-white p-4 rounded-lg shadow-sm border-l-4 border-${k.c}-500 cursor-pointer hover:bg-gray-50`}>
                        <div className="text-xs text-gray-500 font-bold uppercase">{k.l}</div>
                        <div className={`text-2xl font-bold text-${k.c}-700`}>{k.v}</div>
                    </div>
                ))}
            </div>

            {/* CONTROLLI LISTA */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex gap-2">
                    <button onClick={() => expandAll(true)} className="text-xs bg-white border px-3 py-1 rounded hover:bg-gray-50">Expand All</button>
                    <button onClick={() => expandAll(false)} className="text-xs bg-white border px-3 py-1 rounded hover:bg-gray-50">Collapse All</button>
                </div>
                <div className="text-sm text-gray-500">
                    Filtro: <b>{filterStatus}</b>
                </div>
            </div>

            {/* GERARCHIA: SUBSCRIPTION -> RG -> RESOURCES */}
            <div className="space-y-6">
                {groupedData.map((subNode: any) => (
                    <div key={subNode.meta.subscriptionId} className="bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
                        {/* BOX SOTTOSCRIZIONE */}
                        <div 
                           onClick={() => setExpandedSubs({...expandedSubs, [subNode.meta.subscriptionId]: !expandedSubs[subNode.meta.subscriptionId]})}
                           className="bg-gray-100 px-4 py-3 flex justify-between items-center cursor-pointer border-b border-gray-200 hover:bg-gray-200"
                        >
                            <div className="flex items-center gap-3">
                                <span className="font-mono text-xs bg-gray-300 px-2 py-1 rounded text-gray-700">SUB</span>
                                <div>
                                    <div className="font-bold text-gray-800">{subNode.meta.displayName}</div>
                                    <div className="text-xs text-gray-500 font-mono">{subNode.meta.subscriptionId}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                {getStatusBadge(subNode.worstStatus as string)}
                                <svg className={`w-5 h-5 text-gray-500 transform transition-transform ${expandedSubs[subNode.meta.subscriptionId] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </div>
                        </div>

                        {/* LISTA RG NELLA SUBSCRIPTION */}
                        {expandedSubs[subNode.meta.subscriptionId] && (
                            <div className="p-4 bg-gray-50 space-y-3">
                                {subNode.groupList.map((rg: any) => (
                                    <div key={rg.name} className="border border-gray-200 rounded-md bg-white overflow-hidden">
                                        <div 
                                            onClick={() => setExpandedGroups({...expandedGroups, [`${subNode.meta.subscriptionId}-${rg.name}`]: !expandedGroups[`${subNode.meta.subscriptionId}-${rg.name}`]})}
                                            className="px-4 py-2 flex justify-between items-center cursor-pointer hover:bg-blue-50"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase">RG</span>
                                                <span className="font-medium text-sm text-gray-800">{rg.name}</span>
                                                <span className="text-xs text-gray-400">({rg.resources.length})</span>
                                            </div>
                                            {getStatusBadge(rg.worstStatus)}
                                        </div>

                                        {expandedGroups[`${subNode.meta.subscriptionId}-${rg.name}`] && (
                                            <div className="border-t border-gray-100">
                                                {rg.resources.map((res: any) => (
                                                    <div key={res.id} className="p-3 border-b border-gray-50 last:border-0 hover:bg-yellow-50 flex gap-4">
                                                        <div className="w-1/3">
                                                            <div className="text-sm font-bold text-gray-800 break-words">{res.name}</div>
                                                            <div className="text-[10px] text-gray-500">{res.type}</div>
                                                        </div>
                                                        <div className="w-24 pt-1">{getStatusBadge(res.migrationStatus)}</div>
                                                        <div className="flex-1 text-sm text-gray-600">
                                                            {res.issues.length > 0 ? (
                                                                <ul className="list-disc pl-4 space-y-1">
                                                                    {res.issues.map((i: any, idx: number) => (
                                                                        <li key={idx}>
                                                                            <span className="font-bold text-gray-800">{i.message}</span> - {i.impact}
                                                                            {i.workaround && <div className="text-xs bg-slate-100 p-1 mt-1 font-mono text-slate-700">FIX: {i.workaround}</div>}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            ) : <span className="text-green-600 text-xs">Ready</span>}
                                                        </div>
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

        {/* --- VISTA TEST --- */}
        {view === 'test' && (
          <div className="bg-white p-6 rounded shadow text-center">
            <h2 className="text-xl font-bold mb-4">Diagnostica Motore Regole</h2>
            <button onClick={runTest} disabled={loading} className="bg-purple-600 text-white px-6 py-2 rounded hover:bg-purple-700 disabled:opacity-50">
                {loading ? 'Esecuzione...' : 'Lancia Integration Test'}
            </button>
            {testResult && (
                <div className="mt-6 text-left border p-4 rounded bg-gray-50">
                    <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(testResult, null, 2)}</pre>
                </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default App;