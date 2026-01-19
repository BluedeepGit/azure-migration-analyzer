import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// --- TIPI ---

type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info' | 'Ready';

interface Issue {
  severity: string;
  message: string;
  impact: string;
  workaround: string;
  downtimeRisk: boolean;
  refLink?: string;
}

interface Resource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string;
  migrationStatus: Severity;
  issues: Issue[];
}

interface Summary {
  total: number;
  blockers: number;
  critical: number;
  warnings: number;
  ready: number;
  downtimeRisks: number;
}

interface ApiResponse {
  scenario: MigrationScenario;
  summary: Summary;
  details: Resource[];
}

// Tipi per il Self-Test
interface TestFailure {
  row: number;
  resource: string;
  scenario: string;
  expected: string;
  got: string;
}

interface TestResult {
  passed: number;
  failed: number;
  total: number;
  failures: TestFailure[];
}

// --- HELPER DI PRIORITÀ ---
const SEVERITY_WEIGHT: Record<string, number> = {
  'Blocker': 5,
  'Critical': 4,
  'Warning': 3,
  'Info': 2,
  'Ready': 1
};

function App() {
  // Stati Dati
  const [scenario, setScenario] = useState<MigrationScenario>('cross-tenant');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Stati UI
  const [filterStatus, setFilterStatus] = useState<Severity | 'All' | 'Downtime'>('All');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  
  // Stati Diagnostica
  const [showTest, setShowTest] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // --- API ---
  const fetchData = async (selectedScenario: MigrationScenario) => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`/api/analyze?scenario=${selectedScenario}`);
      setData(response.data);
      // Reset stati UI al cambio scenario
      setFilterStatus('All');
      setExpandedGroups({}); 
    } catch (err: any) {
      setError(err.message || 'Errore backend');
    } finally {
      setLoading(false);
    }
  };

  const runDiagnostics = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await axios.get('/api/admin/run-test');
      setTestResult(res.data);
    } catch (err: any) {
      alert("Errore test: " + err.message);
    } finally {
      setTestLoading(false);
    }
  };

  useEffect(() => {
    if (!showTest) fetchData(scenario);
  }, [scenario, showTest]);

  // --- LOGICA RAGGRUPPAMENTO E FILTRO ---
  
  const processedData = useMemo(() => {
    if (!data) return null;

    // 1. Filtra Risorse
    const filteredResources = data.details.filter(res => {
      if (filterStatus === 'All') return true;
      if (filterStatus === 'Downtime') return res.issues.some(i => i.downtimeRisk);
      return res.migrationStatus === filterStatus;
    });

    // 2. Raggruppa per Resource Group
    const groups: Record<string, Resource[]> = {};
    filteredResources.forEach(res => {
      const rg = res.resourceGroup || 'Unknown Resource Group';
      if (!groups[rg]) groups[rg] = [];
      groups[rg].push(res);
    });

    // 3. Calcola Status Peggiore per Gruppo
    const groupMetas = Object.keys(groups).map(rgName => {
      const resources = groups[rgName];
      let worstStatus: Severity = 'Ready';
      let maxWeight = 0;

      resources.forEach(r => {
        const w = SEVERITY_WEIGHT[r.migrationStatus] || 0;
        if (w > maxWeight) {
          maxWeight = w;
          worstStatus = r.migrationStatus;
        }
      });

      return {
        name: rgName,
        resources,
        worstStatus,
        count: resources.length
      };
    }).sort((a, b) => {
        // Ordina gruppi per gravità (Blocker prima di Ready)
        return SEVERITY_WEIGHT[b.worstStatus] - SEVERITY_WEIGHT[a.worstStatus];
    });

    return groupMetas;
  }, [data, filterStatus]);


  // --- HELPER UI ---

  const toggleGroup = (rgName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [rgName]: !prev[rgName]
    }));
  };

  const getStatusBadge = (status: string, size: 'sm' | 'md' = 'sm') => {
    const styles: Record<string, string> = {
      Blocker: 'bg-red-900 text-white border-red-900',
      Critical: 'bg-red-100 text-red-700 border-red-200',
      Warning: 'bg-orange-100 text-orange-700 border-orange-200',
      Info: 'bg-blue-50 text-blue-600 border-blue-200',
      Ready: 'bg-green-100 text-green-700 border-green-200'
    };
    const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs';
    return (
      <span className={`rounded border font-bold uppercase tracking-wider ${sizeClass} ${styles[status] || 'bg-gray-100'}`}>
        {status}
      </span>
    );
  };

  // --- RENDER ---

  return (
    <div className="min-h-screen bg-gray-50 pb-12 font-sans text-gray-900">
      
      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white shadow-sm">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Azure Migration Analyzer</h1>
              <p className="text-xs text-gray-500">Governance & Assessment Tool</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowTest(!showTest)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border
                ${showTest 
                  ? 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300' 
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-200'}`}
            >
              {showTest ? '← Report' : '🛠 Diagnostica'}
            </button>

            {!showTest && (
              <select 
                value={scenario}
                onChange={(e) => setScenario(e.target.value as MigrationScenario)}
                className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm font-medium min-w-[200px]"
              >
                <option value="cross-tenant">Tenant to Tenant</option>
                <option value="cross-subscription">Subscription Move</option>
                <option value="cross-resourcegroup">Resource Group Move</option>
                <option value="cross-region">Region Move</option>
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        
        {/* VISTA DIAGNOSTICA (TEST) */}
        {showTest ? (
           /* ... (Logica Test invariata dal passo precedente) ... */
           <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200">
             {/* ... Pulsante Run e Tabella Risultati (copia dal codice precedente se serve, qui sintetizzo per focus sulla dashboard) ... */}
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Diagnostica Motore Regole</h2>
                <button onClick={runDiagnostics} disabled={testLoading} className="bg-purple-600 text-white px-6 py-2 rounded font-bold hover:bg-purple-700">
                    {testLoading ? 'Esecuzione...' : 'Esegui Test'}
                </button>
             </div>
             {testResult && (
                 <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="bg-blue-50 p-4 rounded border border-blue-100 flex-1 text-center">
                            <div className="text-3xl font-bold text-blue-700">{testResult.total}</div>
                            <div className="text-xs text-blue-500 font-bold uppercase">Test Totali</div>
                        </div>
                        <div className="bg-green-50 p-4 rounded border border-green-100 flex-1 text-center">
                            <div className="text-3xl font-bold text-green-700">{testResult.passed}</div>
                            <div className="text-xs text-green-500 font-bold uppercase">Superati</div>
                        </div>
                        <div className={`p-4 rounded border flex-1 text-center ${testResult.failed > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                            <div className={`text-3xl font-bold ${testResult.failed > 0 ? 'text-red-700' : 'text-gray-400'}`}>{testResult.failed}</div>
                            <div className="text-xs text-gray-500 font-bold uppercase">Falliti</div>
                        </div>
                    </div>
                    {testResult.failed > 0 && (
                        <div className="border rounded overflow-hidden mt-4">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-100 text-xs uppercase font-bold text-gray-500">
                                    <tr><th className="p-3 text-left">Res</th><th className="p-3 text-left">Exp</th><th className="p-3 text-left">Got</th></tr>
                                </thead>
                                <tbody>
                                    {testResult.failures.map((f, i) => (
                                        <tr key={i} className="border-t">
                                            <td className="p-3 font-mono text-xs">{f.resource}</td>
                                            <td className="p-3 text-green-600 font-bold">{f.expected}</td>
                                            <td className="p-3 text-red-600 font-bold">{f.got}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {testResult.failed === 0 && <div className="p-4 bg-green-100 text-green-800 rounded">✅ Test Superato.</div>}
                 </div>
             )}
           </div>
        ) : (
          /* VISTA DASHBOARD (MIGLIORATA) */
          <>
            {loading && (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600"></div>
                <p className="mt-4 text-gray-500 font-medium">Analisi in corso...</p>
              </div>
            )}

            {error && (
               <div className="bg-red-50 border-l-4 border-red-500 p-4 text-red-700 mb-8">{error}</div>
            )}
            
            {data && !loading && processedData && (
              <div className="animate-fade-in">
                
                {/* FILTRI KPI INTERATTIVI */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
                    {[
                        { label: 'Total', val: data.summary.total, status: 'All', color: 'border-gray-200 text-gray-700' },
                        { label: 'Downtime', val: data.summary.downtimeRisks, status: 'Downtime', color: 'border-purple-500 text-purple-700', icon: true },
                        { label: 'Blockers', val: data.summary.blockers, status: 'Blocker', color: 'border-red-800 text-red-900' },
                        { label: 'Critical', val: data.summary.critical, status: 'Critical', color: 'border-red-500 text-red-600' },
                        { label: 'Warnings', val: data.summary.warnings, status: 'Warning', color: 'border-orange-400 text-orange-600' },
                        { label: 'Ready', val: data.summary.ready, status: 'Ready', color: 'border-green-500 text-green-600' },
                    ].map((kpi) => (
                        <div 
                            key={kpi.label}
                            onClick={() => setFilterStatus(kpi.status as any)}
                            className={`
                                bg-white p-4 rounded-xl border-l-4 shadow-sm cursor-pointer transition-all transform hover:scale-105 active:scale-95
                                ${kpi.color.split(' ')[0]} 
                                ${filterStatus === kpi.status ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
                            `}
                        >
                            <div className={`text-xs uppercase font-bold tracking-wider flex items-center gap-1 ${kpi.color.split(' ')[1]}`}>
                                {kpi.icon && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                                {kpi.label}
                            </div>
                            <div className="text-3xl font-extrabold text-gray-800 mt-1">{kpi.val}</div>
                        </div>
                    ))}
                </div>

                {/* LISTA RAGGRUPPATA PER RESOURCE GROUP */}
                <div className="space-y-4">
                  {processedData.map((group) => (
                    <div key={group.name} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      
                      {/* HEADER GRUPPO (Cliccabile) */}
                      <div 
                        onClick={() => toggleGroup(group.name)}
                        className={`
                            px-6 py-4 flex justify-between items-center cursor-pointer transition-colors
                            ${expandedGroups[group.name] ? 'bg-gray-50 border-b border-gray-200' : 'bg-white hover:bg-gray-50'}
                        `}
                      >
                        <div className="flex items-center gap-4">
                            {/* Icona Chevron */}
                            <svg className={`w-5 h-5 text-gray-400 transition-transform ${expandedGroups[group.name] ? 'transform rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            
                            <div>
                                <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                    {group.name}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                    {group.count} risorse
                                </div>
                            </div>
                        </div>

                        {/* Status Sintetico del Gruppo */}
                        <div>
                            {getStatusBadge(group.worstStatus, 'md')}
                        </div>
                      </div>

                      {/* CORPO GRUPPO (Risorse) */}
                      {expandedGroups[group.name] && (
                        <div className="bg-gray-50/50 p-0 animate-fade-in-down">
                            <table className="min-w-full divide-y divide-gray-100">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-2 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Risorsa</th>
                                        <th className="px-6 py-2 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider w-32">Status</th>
                                        <th className="px-6 py-2 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Analisi</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                    {group.resources.map(res => (
                                        <tr key={res.id} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="px-6 py-4 align-top w-1/4">
                                                <div className="font-semibold text-sm text-gray-800 break-words">{res.name}</div>
                                                <div className="inline-block mt-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-mono border border-gray-200">
                                                    {res.type.split('/').pop()}
                                                </div>
                                                <div className="text-[10px] text-gray-400 mt-1">{res.location}</div>
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                <div className="flex flex-col gap-2 items-start">
                                                    {getStatusBadge(res.migrationStatus)}
                                                    {res.issues.some(i => i.downtimeRisk) && (
                                                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-100">
                                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                                                            Downtime
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                {res.issues.length > 0 ? (
                                                    <div className="space-y-3">
                                                        {res.issues.map((issue, idx) => (
                                                            <div key={idx} className="relative pl-3 border-l-2 border-gray-300">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                     <span className={`w-2 h-2 rounded-full ${
                                                                        issue.severity === 'Blocker' ? 'bg-red-800' :
                                                                        issue.severity === 'Critical' ? 'bg-red-500' :
                                                                        issue.severity === 'Warning' ? 'bg-orange-400' : 'bg-blue-400'
                                                                     }`}></span>
                                                                     <span className="text-sm font-bold text-gray-800">{issue.message}</span>
                                                                </div>
                                                                
                                                                <p className="text-sm text-gray-600 mb-1">
                                                                    <span className="font-semibold text-[10px] uppercase text-gray-500">Impatto:</span> {issue.impact}
                                                                </p>
                                                                
                                                                <div className="bg-slate-50 p-2 rounded border border-slate-100 text-xs font-mono text-slate-600">
                                                                    <span className="font-bold text-slate-800">FIX:</span> {issue.workaround}
                                                                </div>

                                                                {issue.refLink && (
                                                                    <a href={issue.refLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline text-[10px] mt-1 font-medium">
                                                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                                        Documentazione
                                                                    </a>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 text-green-600 text-xs">
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                        Pronto per la migrazione
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {processedData.length === 0 && (
                      <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
                          <p className="text-gray-500">Nessuna risorsa trovata con il filtro "{filterStatus}".</p>
                          <button onClick={() => setFilterStatus('All')} className="text-blue-600 font-bold mt-2 hover:underline">Reset Filtri</button>
                      </div>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;