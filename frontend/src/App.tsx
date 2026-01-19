import { useState, useEffect } from 'react';
import axios from 'axios';

// --- TIPI ---

// Tipi per la Dashboard Principale
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';

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
  migrationStatus: 'Ready' | 'Warning' | 'Critical' | 'Blocker' | 'Info';
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

// Tipi per il Self-Test (Diagnostica)
interface TestFailure {
  row: number;
  resource: string;
  scenario: string;
  expected: string;
  got: string;
  csvLink?: string;
}

interface TestResult {
  passed: number;
  failed: number;
  total: number;
  failures: TestFailure[];
}

function App() {
  // Stati Dashboard
  const [scenario, setScenario] = useState<MigrationScenario>('cross-tenant');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Stati Diagnostica (Self-Test)
  const [showTest, setShowTest] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // --- LOGICA ---

  // Carica i dati reali da Azure
  const fetchData = async (selectedScenario: MigrationScenario) => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`/api/analyze?scenario=${selectedScenario}`);
      setData(response.data);
    } catch (err: any) {
      setError(err.message || 'Errore di connessione al backend');
    } finally {
      setLoading(false);
    }
  };

  // Esegue il test di integrazione (CSV vs Rules Engine)
  const runDiagnostics = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await axios.get('/api/admin/run-test');
      setTestResult(res.data);
    } catch (err: any) {
      alert("Errore esecuzione test: " + err.message);
    } finally {
      setTestLoading(false);
    }
  };

  // Trigger iniziale e cambio scenario
  useEffect(() => {
    if (!showTest) {
      fetchData(scenario);
    }
  }, [scenario, showTest]);

  // Helper per le badge colorate
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      Blocker: 'bg-red-900 text-white border-red-900',
      Critical: 'bg-red-100 text-red-700 border-red-200',
      Warning: 'bg-orange-100 text-orange-700 border-orange-200',
      Info: 'bg-blue-50 text-blue-600 border-blue-200',
      Ready: 'bg-green-100 text-green-700 border-green-200'
    };
    return (
      <span className={`px-2 py-1 rounded border text-xs font-bold uppercase tracking-wider ${styles[status] || 'bg-gray-100'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12 font-sans text-gray-900">
      
      {/* --- HEADER --- */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Azure Migration Analyzer</h1>
              <p className="text-xs text-gray-500">Governance & Assessment Tool</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Toggle Diagnostica */}
            <button 
              onClick={() => setShowTest(!showTest)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2
                ${showTest 
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300' 
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'}`}
            >
              {showTest ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                  Torna al Report
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Diagnostica Regole
                </>
              )}
            </button>

            {/* Select Scenario (solo se non in test) */}
            {!showTest && (
              <div className="relative">
                <select 
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as MigrationScenario)}
                  className="appearance-none bg-white border border-gray-300 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 pr-8 shadow-sm font-medium"
                >
                  <option value="cross-tenant">Tenant to Tenant (Transfer)</option>
                  <option value="cross-subscription">Subscription to Subscription</option>
                  <option value="cross-resourcegroup">Resource Group Move</option>
                  <option value="cross-region">Region to Region (Move)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        
        {/* =========================================================================
            VISTA 1: DIAGNOSTICA (TEST SU CSV)
           ========================================================================= */}
        {showTest ? (
          <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Integration Self-Test</h2>
                <p className="text-gray-500 mt-2 max-w-2xl">
                  Questa procedura simula l'analisi su tutte le righe del file CSV originale (Matrice di Supporto Microsoft)
                  e verifica che il motore di regole JSON produca il risultato atteso (Blocker/Critical) per ogni risorsa.
                </p>
              </div>
              <button 
                onClick={runDiagnostics} 
                disabled={testLoading}
                className="bg-purple-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-purple-700 disabled:opacity-50 shadow-md transition-all active:scale-95"
              >
                {testLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Esecuzione in corso...
                  </span>
                ) : 'Lancia Test Completo'}
              </button>
            </div>

            {testResult && (
              <div className="animate-fade-in-up">
                <div className="grid grid-cols-3 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 text-center">
                    <div className="text-4xl font-extrabold text-blue-700">{testResult.total}</div>
                    <div className="text-xs uppercase font-bold text-blue-500 mt-1">Test Eseguiti</div>
                  </div>
                  <div className="bg-green-50 p-6 rounded-xl border border-green-100 text-center">
                    <div className="text-4xl font-extrabold text-green-700">{testResult.passed}</div>
                    <div className="text-xs uppercase font-bold text-green-600 mt-1">Superati</div>
                  </div>
                  <div className={`p-6 rounded-xl border text-center ${testResult.failed > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                    <div className={`text-4xl font-extrabold ${testResult.failed > 0 ? 'text-red-700' : 'text-gray-400'}`}>{testResult.failed}</div>
                    <div className={`text-xs uppercase font-bold mt-1 ${testResult.failed > 0 ? 'text-red-600' : 'text-gray-400'}`}>Falliti</div>
                  </div>
                </div>

                {testResult.failed === 0 ? (
                  <div className="p-6 bg-green-100 text-green-900 rounded-lg border border-green-200 flex items-center gap-4">
                    <div className="bg-green-200 p-2 rounded-full">
                      <svg className="w-8 h-8 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">Integrità Verificata</h3>
                      <p className="text-green-800">Il motore di regole è perfettamente allineato con la matrice CSV ufficiale.</p>
                    </div>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-red-50 px-6 py-4 border-b border-red-100">
                      <h3 className="text-lg font-bold text-red-800">Dettagli Discrepanze ({testResult.failed})</h3>
                    </div>
                    <div className="max-h-[500px] overflow-y-auto">
                      <table className="min-w-full text-sm text-left">
                        <thead className="bg-gray-50 text-xs uppercase text-gray-500 sticky top-0">
                          <tr>
                            <th className="px-6 py-3">Row</th>
                            <th className="px-6 py-3">Risorsa</th>
                            <th className="px-6 py-3">Scenario</th>
                            <th className="px-6 py-3">Atteso (CSV)</th>
                            <th className="px-6 py-3">Ottenuto (Engine)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {testResult.failures.map((fail, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-6 py-3 font-mono text-gray-400">{fail.row}</td>
                              <td className="px-6 py-3 font-semibold text-gray-800">{fail.resource}</td>
                              <td className="px-6 py-3 text-gray-600">{fail.scenario}</td>
                              <td className="px-6 py-3 text-green-700 font-medium">{fail.expected}</td>
                              <td className="px-6 py-3 text-red-600 font-bold bg-red-50">{fail.got}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* =========================================================================
             VISTA 2: REPORT REALE (AZURE GRAPH)
             ========================================================================= */
          <>
            {loading && (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600"></div>
                <p className="mt-6 text-lg text-gray-500 font-medium">Analisi inventario Azure in corso...</p>
                <p className="text-sm text-gray-400">Recupero configurazioni e applicazione regole per {scenario}</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-md shadow-sm mb-8">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm leading-5 font-medium text-red-800">Errore API</h3>
                    <div className="mt-2 text-sm leading-5 text-red-700">{error}</div>
                  </div>
                </div>
              </div>
            )}
            
            {data && !loading && (
              <div className="animate-fade-in">
                {/* KPI CARDS */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-xs uppercase font-bold tracking-wider">Total Resources</div>
                    <div className="text-3xl font-extrabold text-gray-800 mt-1">{data.summary.total}</div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border-l-4 border-purple-600 shadow-sm">
                    <div className="text-purple-800 text-xs uppercase font-bold tracking-wider flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      Downtime Risks
                    </div>
                    <div className="text-3xl font-extrabold text-purple-700 mt-1">{data.summary.downtimeRisks}</div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border-l-4 border-red-800 shadow-sm">
                    <div className="text-red-900 text-xs uppercase font-bold tracking-wider">Blockers</div>
                    <div className="text-3xl font-extrabold text-red-900 mt-1">{data.summary.blockers}</div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border-l-4 border-red-500 shadow-sm">
                    <div className="text-red-600 text-xs uppercase font-bold tracking-wider">Critical</div>
                    <div className="text-3xl font-extrabold text-red-600 mt-1">{data.summary.critical}</div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border-l-4 border-orange-400 shadow-sm">
                    <div className="text-orange-600 text-xs uppercase font-bold tracking-wider">Warnings</div>
                    <div className="text-3xl font-extrabold text-orange-600 mt-1">{data.summary.warnings}</div>
                  </div>
                  <div className="bg-white p-5 rounded-xl border-l-4 border-green-500 shadow-sm">
                    <div className="text-green-600 text-xs uppercase font-bold tracking-wider">Ready</div>
                    <div className="text-3xl font-extrabold text-green-600 mt-1">{data.summary.ready}</div>
                  </div>
                </div>

                {/* DETAILED TABLE */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-800">Dettaglio Analisi</h3>
                    <div className="text-xs font-mono bg-white px-3 py-1 rounded border border-gray-200 text-gray-500">
                      Scenario: {data.scenario}
                    </div>
                  </div>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Risorsa</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Analisi</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-1/2">Dettagli Tecnici (Issues, Impact & Fix)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {data.details.map((res) => (
                        <tr key={res.id} className="hover:bg-gray-50 group transition-colors">
                          <td className="px-6 py-4 align-top">
                            <div className="text-sm font-bold text-gray-900">{res.name}</div>
                            <div className="text-xs text-gray-500 mt-1 mb-2">{res.resourceGroup}</div>
                            <div className="inline-block px-2 py-1 rounded bg-blue-50 text-blue-700 text-[10px] font-mono border border-blue-100">
                              {res.type.split('/').pop()}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-1">{res.location}</div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            <div className="flex flex-col gap-2 items-start">
                              {getStatusBadge(res.migrationStatus)}
                              
                              {/* Downtime Badge */}
                              {res.issues.some(i => i.downtimeRisk) && (
                                <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs font-bold border border-purple-200 animate-pulse-slow">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                                  Downtime
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 align-top">
                            {res.issues.length > 0 ? (
                              <div className="space-y-4">
                                {res.issues.map((issue, idx) => (
                                  <div key={idx} className="relative pl-4 border-l-4 border-gray-200 hover:border-gray-400 transition-colors">
                                    {/* Severity & Message */}
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 
                                        ${issue.severity === 'Blocker' ? 'bg-red-900' : ''}
                                        ${issue.severity === 'Critical' ? 'bg-red-600' : ''}
                                        ${issue.severity === 'Warning' ? 'bg-orange-500' : ''}
                                        ${issue.severity === 'Info' ? 'bg-blue-400' : ''}
                                      `}></span>
                                      <span className="text-sm font-bold text-gray-900">{issue.message}</span>
                                    </div>
                                    
                                    {/* Impact Section */}
                                    <div className="text-sm text-gray-700 mb-2 leading-snug">
                                      <span className="font-bold text-gray-900 text-xs uppercase tracking-wide">Impatto: </span>
                                      {issue.impact}
                                    </div>

                                    {/* Workaround Box */}
                                    <div className="bg-slate-800 rounded p-3 text-xs text-slate-200 font-mono mt-2 shadow-inner">
                                      <div className="text-slate-400 font-bold mb-1 uppercase tracking-wider flex items-center gap-2">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                                        Workaround / Fix:
                                      </div>
                                      {issue.workaround}
                                    </div>

                                    {/* Link Doc */}
                                    {issue.refLink && (
                                      <a 
                                        href={issue.refLink} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline text-xs mt-3 font-medium transition-colors"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                        Documentazione Ufficiale Microsoft
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 p-2 rounded border border-green-100">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <span className="font-medium">Nessun problema noto per questo scenario</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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