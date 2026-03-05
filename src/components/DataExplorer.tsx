import { useState, useEffect, useCallback } from 'react';

const DRIZZLE_API = 'https://drizzle.vegvisr.org';

interface TableMeta {
  id: string;
  graphId: string;
  tableName: string;
  displayName: string;
  createdAt: string;
  createdBy: string | null;
}

interface ColumnMeta {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

interface TableDetail extends TableMeta {
  columns: ColumnMeta[];
}

interface QueryResult {
  records: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  columns: ColumnMeta[];
}

export default function DataExplorer() {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableDetail, setTableDetail] = useState<TableDetail | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Load all tables
  useEffect(() => {
    setLoading(true);
    fetch(`${DRIZZLE_API}/tables`)
      .then(res => res.json())
      .then(data => setTables(data.tables || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Load table detail + data when selected
  const loadTable = useCallback(async (tableId: string, offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, queryRes] = await Promise.all([
        fetch(`${DRIZZLE_API}/table/${tableId}`),
        fetch(`${DRIZZLE_API}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId, limit: pageSize, offset }),
        }),
      ]);
      if (!detailRes.ok) throw new Error('Failed to load table schema');
      if (!queryRes.ok) throw new Error('Failed to query table');
      const detail = await detailRes.json();
      const query = await queryRes.json();
      setTableDetail(detail);
      setQueryResult(query);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setPage(0);
    loadTable(tableId, 0);
  };

  const handlePageChange = (newPage: number) => {
    if (!selectedTableId) return;
    setPage(newPage);
    loadTable(selectedTableId, newPage * pageSize);
  };

  const handleDropTable = async (tableId: string) => {
    if (!confirm('Are you sure you want to drop this table? This cannot be undone.')) return;
    try {
      const res = await fetch(`${DRIZZLE_API}/drop-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId }),
      });
      if (!res.ok) throw new Error('Failed to drop table');
      setTables(prev => prev.filter(t => t.id !== tableId));
      if (selectedTableId === tableId) {
        setSelectedTableId(null);
        setTableDetail(null);
        setQueryResult(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to drop table');
    }
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left sidebar — table list */}
      <div className="w-72 border-r border-white/10 flex flex-col bg-slate-950/50">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white">App Tables</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{tables.length} table{tables.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tables.length === 0 && !loading && (
            <p className="px-4 py-6 text-xs text-gray-500 text-center">No tables yet. Use the agent to create one.</p>
          )}
          {tables.map(t => (
            <button
              key={t.id}
              onClick={() => handleSelectTable(t.id)}
              className={`w-full text-left px-4 py-2.5 border-b border-white/5 transition-colors ${
                selectedTableId === t.id
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              <div className="text-xs font-medium truncate">{t.displayName}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 truncate">{t.tableName}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">Graph: {t.graphId}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Right content — table data */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="px-4 py-2 bg-red-900/30 border-b border-red-600/30 text-xs text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">dismiss</button>
          </div>
        )}

        {!selectedTableId && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-500">Select a table from the sidebar</p>
          </div>
        )}

        {selectedTableId && tableDetail && (
          <>
            {/* Table header */}
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">{tableDetail.displayName}</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {tableDetail.tableName} &middot; {queryResult?.total ?? 0} record{(queryResult?.total ?? 0) !== 1 ? 's' : ''} &middot; {tableDetail.columns.length} column{tableDetail.columns.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600">ID: {tableDetail.id.slice(0, 8)}...</span>
                <button
                  onClick={() => handleDropTable(tableDetail.id)}
                  className="px-2 py-1 text-[10px] text-red-400 border border-red-600/30 rounded hover:bg-red-600/20 transition-colors"
                >
                  Drop
                </button>
              </div>
            </div>

            {/* Schema */}
            <div className="px-5 py-2 border-b border-white/10 flex gap-2 flex-wrap">
              {tableDetail.columns.map(col => (
                <span key={col.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-white/5 text-[10px]">
                  <span className="text-gray-300">{col.label}</span>
                  <span className="text-gray-600">({col.type})</span>
                  {col.required && <span className="text-amber-500">*</span>}
                </span>
              ))}
            </div>

            {/* Data table */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-xs text-gray-500">Loading...</p>
                </div>
              ) : queryResult && queryResult.records.length > 0 ? (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900/95">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium border-b border-white/10">_id</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium border-b border-white/10">_created_at</th>
                      {tableDetail.columns.map(col => (
                        <th key={col.name} className="text-left px-3 py-2 text-gray-500 font-medium border-b border-white/10">{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.records.map((row, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2 text-gray-600 font-mono">{String(row._id ?? '').slice(0, 8)}...</td>
                        <td className="px-3 py-2 text-gray-500">{row._created_at ? new Date(String(row._created_at)).toLocaleString() : ''}</td>
                        {tableDetail.columns.map(col => (
                          <td key={col.name} className="px-3 py-2 text-gray-300">{String(row[col.name] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center justify-center py-12">
                  <p className="text-xs text-gray-500">No records yet</p>
                </div>
              )}
            </div>

            {/* Pagination */}
            {queryResult && queryResult.total > pageSize && (
              <div className="px-5 py-2 border-t border-white/10 flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, queryResult.total)} of {queryResult.total}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={page === 0}
                    onClick={() => handlePageChange(page - 1)}
                    className="px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <button
                    disabled={(page + 1) * pageSize >= queryResult.total}
                    onClick={() => handlePageChange(page + 1)}
                    className="px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
