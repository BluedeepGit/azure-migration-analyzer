import { useState, useEffect } from 'react';
import axios from 'axios';

type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';

interface Issue {
  severity: string;
  message: string;
  impact: string;       // NUOVO
  workaround: string;   // NUOVO
  downtimeRisk: boolean; // NUOVO
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
  downtimeRisks: number; // NUOVO KPI
}

interface ApiResponse {
  scenario: MigrationScenario;
  summary: Summary;
  details: Resource[];
}

function App() {
  const [scenario, setScenario] = useState<MigrationScenario>('cross-tenant');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async (selectedScenario: MigrationScenario) => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`/api/analyze?scenario=${selectedScenario}`);
      setData(response.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(scenario);
  }, [scenario]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      Blocker: 'bg-red-900 text-white border-red-900',
      Critical: 'bg-red-100 text-red-700 border-red-200',
      Warning: 'bg-orange-100 text-orange-700 border-orange-200',
      Info: 'bg-blue-50 text-blue-600 border-blue-200',
      Ready: 'bg-green-100 text-green-700 border-green-200'
    };
    return (
      <span className={`px-2 py-1 rounded border text-xs font-bold uppercase ${styles[status] || 'bg-gray-100'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
              Azure Migration Analyzer
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Scenario:</span>
            <select 
              value={scenario}
              onChange={(e) => setScenario(e.target.value as MigrationScenario)}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
            >
              <option value="cross-tenant">Tenant to Tenant (Transfer)</option>
              <option value="cross-subscription">Subscription to Subscription</option>
              <option value="cross-resourcegroup">Resource Group Move</option>
              <option value="cross-region">Region to Region (Mover)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8">
        {loading && <div className="text-center py-12 text-gray-500">Analisi in corso...</div>}
        
        {data && !loading && (
          <>
            {/* KPI GRID */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
              <div className="bg-white p-4 rounded border border-gray-200 shadow-sm">
                <div className="text-gray-500 text-xs uppercase font-bold">Total Resources</div>
                <div className="text-2xl font-bold text-gray-800">{data.summary.total}</div>
              </div>
              <div className="bg-white p-4 rounded border-l-4 border-purple-600 shadow-sm">
                <div className="text-purple-800 text-xs uppercase font-bold flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Downtime Risks
                </div>
                <div className="text-2xl font-bold text-purple-700">{data.summary.downtimeRisks}</div>
              </div>
              <div className="bg-white p-4 rounded border-l-4 border-red-800 shadow-sm">
                <div className="text-red-900 text-xs uppercase font-bold">Blockers</div>
                <div className="text-2xl font-bold text-red-900">{data.summary.blockers}</div>
              </div>
              <div className="bg-white p-4 rounded border-l-4 border-red-500 shadow-sm">
                <div className="text-red-600 text-xs uppercase font-bold">Critical</div>
                <div className="text-2xl font-bold text-red-600">{data.summary.critical}</div>
              </div>
              <div className="bg-white p-4 rounded border-l-4 border-orange-400 shadow-sm">
                <div className="text-orange-600 text-xs uppercase font-bold">Warnings</div>
                <div className="text-2xl font-bold text-orange-600">{data.summary.warnings}</div>
              </div>
              <div className="bg-white p-4 rounded border-l-4 border-green-500 shadow-sm">
                <div className="text-green-600 text-xs uppercase font-bold">Ready</div>
                <div className="text-2xl font-bold text-green-600">{data.summary.ready}</div>
              </div>
            </div>

            {/* DETAILED TABLE */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Resource</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Analysis</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase w-1/2">Issues, Impact & Workarounds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {data.details.map((res) => (
                    <tr key={res.id} className="hover:bg-gray-50 group">
                      <td className="px-6 py-4 align-top">
                        <div className="text-sm font-bold text-gray-900">{res.name}</div>
                        <div className="text-xs text-gray-500 mb-1">{res.resourceGroup}</div>
                        <div className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-mono border border-blue-100">
                          {res.type.split('/').pop()}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top">
                        <div className="flex flex-col gap-2 items-start">
                          {getStatusBadge(res.migrationStatus)}
                          {/* Downtime Badge */}
                          {res.issues.some(i => i.downtimeRisk) && (
                            <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-800 text-xs font-bold border border-purple-200">
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
                              <div key={idx} className="relative pl-4 border-l-2 border-gray-300">
                                {/* Severity & Message */}
                                <div className="flex items-baseline gap-2 mb-1">
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 
                                    ${issue.severity === 'Blocker' ? 'bg-red-900' : ''}
                                    ${issue.severity === 'Critical' ? 'bg-red-600' : ''}
                                    ${issue.severity === 'Warning' ? 'bg-orange-500' : ''}
                                    ${issue.severity === 'Info' ? 'bg-blue-400' : ''}
                                  `}></span>
                                  <span className="text-sm font-bold text-gray-900">{issue.message}</span>
                                </div>
                                
                                {/* Impact Section */}
                                <div className="text-sm text-gray-600 mb-2">
                                  <span className="font-semibold text-gray-700">Impatto: </span>
                                  {issue.impact}
                                </div>

                                {/* Workaround Box */}
                                <div className="bg-slate-800 rounded p-3 text-xs text-slate-200 font-mono mt-1">
                                  <div className="text-slate-400 font-bold mb-1 uppercase tracking-wider">Workaround / Fix:</div>
                                  {issue.workaround}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-green-600 text-sm">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <span className="font-medium">Nessuna azione richiesta</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;