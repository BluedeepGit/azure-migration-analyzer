import { useState, useEffect } from 'react';
import axios from 'axios';

interface Issue {
  severity: string;
  message: string;
  remediation: string;
}

interface Resource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  migrationStatus: 'Ready' | 'Warning' | 'Critical' | 'Blocker';
  issues: Issue[];
}

interface Summary {
  total: number;
  blockers: number;
  critical: number;
  warnings: number;
  ready: number;
}

function App() {
  const [data, setData] = useState<{ summary: Summary, details: Resource[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Carica i dati all'avvio
  useEffect(() => {
    setLoading(true);
    axios.get('/api/analyze')
      .then(res => setData(res.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const getStatusBadge = (status: string) => {
    const styles = {
      Blocker: 'bg-red-800 text-white',
      Critical: 'bg-red-100 text-red-800 border-red-200 border',
      Warning: 'bg-yellow-100 text-yellow-800 border-yellow-200 border',
      Ready: 'bg-green-100 text-green-800 border-green-200 border'
    };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${styles[status as keyof typeof styles] || ''}`}>
        {status}
      </span>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-screen text-blue-600 text-xl font-semibold">Analisi Azure in corso... attendere...</div>;
  if (error) return <div className="text-red-600 p-8">Errore API: {error}</div>;
  if (!data) return null;

  return (
    <div className="min-h-screen p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Azure Cross-Tenant Migration Report</h1>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-gray-400">
          <p className="text-xs text-gray-500 uppercase">Totale Risorse</p>
          <p className="text-2xl font-bold">{data.summary.total}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-red-800">
          <p className="text-xs text-gray-500 uppercase">Blockers</p>
          <p className="text-2xl font-bold text-red-800">{data.summary.blockers}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-red-500">
          <p className="text-xs text-gray-500 uppercase">Critical</p>
          <p className="text-2xl font-bold text-red-500">{data.summary.critical}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-yellow-500">
          <p className="text-xs text-gray-500 uppercase">Warnings</p>
          <p className="text-2xl font-bold text-yellow-600">{data.summary.warnings}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
          <p className="text-xs text-gray-500 uppercase">Ready</p>
          <p className="text-2xl font-bold text-green-600">{data.summary.ready}</p>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white shadow-lg rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risorsa</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource Group</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Problemi & Rimedi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.details.map((res) => (
              <tr key={res.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">{res.name}</div>
                  <div className="text-xs text-gray-500">{res.type.split('/').pop()}</div>
                  <div className="text-xs text-gray-400">{res.location}</div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{res.resourceGroup}</td>
                <td className="px-6 py-4">{getStatusBadge(res.migrationStatus)}</td>
                <td className="px-6 py-4">
                  {res.issues.length > 0 ? (
                    <ul className="space-y-2">
                      {res.issues.map((issue, idx) => (
                        <li key={idx} className="text-sm">
                          <span className={`font-semibold mr-2 
                            ${issue.severity === 'Blocker' ? 'text-red-800' : ''}
                            ${issue.severity === 'Critical' ? 'text-red-600' : ''}
                            ${issue.severity === 'Warning' ? 'text-yellow-600' : ''}
                          `}>
                            [{issue.severity}]
                          </span>
                          <span className="text-gray-700">{issue.message}</span>
                          <div className="text-xs text-gray-500 mt-1 italic">👉 {issue.remediation}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-green-500 text-sm flex items-center">✓ Nessun problema rilevato</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;