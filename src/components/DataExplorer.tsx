import { useState, useEffect, useCallback } from 'react';

const DRIZZLE_API = 'https://drizzle.vegvisr.org';

interface D1Table {
  name: string;
  rows: number;
}

interface AppTableMeta {
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

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

type TableFilter = 'all' | 'app';

export default function DataExplorer() {
  // Database state
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState('vegvisr_org');

  // Tables state
  const [d1Tables, setD1Tables] = useState<D1Table[]>([]);
  const [appTables, setAppTables] = useState<AppTableMeta[]>([]);
  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Query state
  const [sqlInput, setSqlInput] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Table data state (when clicking a table in sidebar)
  const [tableData, setTableData] = useState<QueryResult | null>(null);
  const [tableColumns, setTableColumns] = useState<ColumnMeta[]>([]);

  // Fetch available databases on mount
  useEffect(() => {
    fetch(`${DRIZZLE_API}/databases`)
      .then(r => r.json())
      .then(data => setDatabases(data.databases || []))
      .catch(() => setDatabases(['vegvisr_org']));
  }, []);

  // Load tables when database changes
  const loadTables = useCallback(async (dbName: string) => {
    setLoading(true);
    setSelectedTable(null);
    setTableData(null);
    setQueryResult(null);
    setTableColumns([]);
    setSqlInput('');
    try {
      const [d1Data, appData] = await Promise.all([
        fetch(`${DRIZZLE_API}/d1-tables?database=${dbName}`).then(r => r.json()).catch(() => ({ tables: [] })),
        dbName === 'vegvisr_org'
          ? fetch(`${DRIZZLE_API}/tables?database=${dbName}`).then(r => r.json()).catch(() => ({ tables: [] }))
          : Promise.resolve({ tables: [] }),
      ]);
      setD1Tables(d1Data.tables || []);
      setAppTables(appData.tables || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables(selectedDb);
  }, [selectedDb, loadTables]);

  // Filtered table list
  const displayTables = tableFilter === 'all'
    ? d1Tables
    : d1Tables.filter(t => appTables.some(a => a.tableName === t.name));

  // App table metadata lookup
  const getAppMeta = (tableName: string) => appTables.find(a => a.tableName === tableName);

  // Select a table → load its data
  const handleSelectTable = useCallback(async (tableName: string) => {
    setSelectedTable(tableName);
    setQueryResult(null);
    setQueryError(null);
    setQueryLoading(true);

    const query = `SELECT * FROM "${tableName}" LIMIT 100`;
    setSqlInput(query);

    try {
      // Check if it's an app table with schema info
      const appMeta = appTables.find(a => a.tableName === tableName);
      if (appMeta) {
        const detailRes = await fetch(`${DRIZZLE_API}/table/${appMeta.id}?database=${selectedDb}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          setTableColumns(detail.columns || []);
        }
      } else {
        setTableColumns([]);
      }

      // Query the table data
      const res = await fetch(`${DRIZZLE_API}/raw-query?database=${selectedDb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Query failed');
      setTableData({ columns: data.columns, rows: data.rows, rowCount: data.rowCount });
    } catch (err: unknown) {
      setTableData(null);
      setQueryError(err instanceof Error ? err.message : 'Failed to load table');
    } finally {
      setQueryLoading(false);
    }
  }, [appTables, selectedDb]);

  // Execute custom SQL
  const handleExecuteQuery = async () => {
    if (!sqlInput.trim()) return;
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    setTableData(null);

    try {
      const res = await fetch(`${DRIZZLE_API}/raw-query?database=${selectedDb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Query failed');
      setQueryResult({ columns: data.columns, rows: data.rows, rowCount: data.rowCount });
    } catch (err: unknown) {
      setQueryError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setQueryLoading(false);
    }
  };

  // Handle Enter key in SQL input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleExecuteQuery();
    }
  };

  // Which result to display
  const activeResult = queryResult || tableData;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left sidebar — table list */}
      <div className="w-72 border-r border-white/10 flex flex-col bg-slate-950/50 flex-shrink-0">
        <div className="px-4 py-3 border-b border-white/10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-white">D1 Tables</h2>
          </div>
          {/* Database selector */}
          <select
            value={selectedDb}
            onChange={e => setSelectedDb(e.target.value)}
            title="Select database"
            className="w-full text-xs bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-amber-300 font-mono focus:outline-none focus:border-amber-500/50 mb-2"
          >
            {databases.map(db => (
              <option key={db} value={db} className="bg-slate-900 text-white">
                {db}
              </option>
            ))}
          </select>
          {/* Filter toggle */}
          <div className="flex rounded-md border border-white/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setTableFilter('all')}
              className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                tableFilter === 'all'
                  ? 'bg-amber-600/30 text-amber-300'
                  : 'text-gray-500 hover:bg-white/5'
              }`}
            >
              All ({d1Tables.length})
            </button>
            <button
              type="button"
              onClick={() => setTableFilter('app')}
              className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                tableFilter === 'app'
                  ? 'bg-amber-600/30 text-amber-300'
                  : 'text-gray-500 hover:bg-white/5'
              }`}
            >
              App ({appTables.length})
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="px-4 py-6 text-xs text-gray-500 text-center">Loading tables...</p>
          )}
          {!loading && displayTables.length === 0 && (
            <p className="px-4 py-6 text-xs text-gray-500 text-center">No tables found</p>
          )}
          {displayTables.map(t => {
            const meta = getAppMeta(t.name);
            const isSystem = t.name === 'app_tables' || t.name === 'app_columns';
            return (
              <button
                type="button"
                key={t.name}
                onClick={() => handleSelectTable(t.name)}
                className={`w-full text-left px-4 py-2.5 border-b border-white/5 transition-colors ${
                  selectedTable === t.name
                    ? 'bg-amber-600/20 text-amber-300'
                    : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate">
                    {meta ? meta.displayName : t.name}
                  </span>
                  <span className="text-[10px] text-gray-600 ml-2 flex-shrink-0">
                    {t.rows >= 0 ? `${t.rows} rows` : '?'}
                  </span>
                </div>
                {meta && (
                  <div className="text-[10px] text-gray-500 mt-0.5 truncate">{t.name}</div>
                )}
                {isSystem && !meta && (
                  <div className="text-[10px] text-gray-600 mt-0.5">system</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* SQL Query bar */}
        <div className="px-4 py-3 border-b border-white/10 bg-slate-900/50">
          <div className="flex gap-2">
            <textarea
              value={sqlInput}
              onChange={e => setSqlInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="SELECT * FROM table_name LIMIT 100"
              rows={2}
              className="flex-1 bg-slate-950 border border-white/10 rounded-md px-3 py-2 text-xs text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-amber-500/50 resize-none"
            />
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={handleExecuteQuery}
                disabled={queryLoading || !sqlInput.trim()}
                className="px-4 py-2 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {queryLoading ? 'Running...' : 'Execute'}
              </button>
              <span className="text-[9px] text-gray-600 text-center">Cmd+Enter</span>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">Read-only queries: SELECT, PRAGMA, EXPLAIN</p>
        </div>

        {/* Error banner */}
        {(error || queryError) && (
          <div className="px-4 py-2 bg-red-900/30 border-b border-red-600/30 text-xs text-red-300">
            {error || queryError}
            <button type="button" onClick={() => { setError(null); setQueryError(null); }} className="ml-2 text-red-400 hover:text-red-200">dismiss</button>
          </div>
        )}

        {/* Schema info (for app tables) */}
        {selectedTable && tableColumns.length > 0 && (
          <div className="px-4 py-2 border-b border-white/10 flex gap-2 flex-wrap">
            {tableColumns.map(col => (
              <span key={col.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-white/5 text-[10px]">
                <span className="text-gray-300">{col.label}</span>
                <span className="text-gray-600">({col.type})</span>
                {col.required && <span className="text-amber-500">*</span>}
              </span>
            ))}
          </div>
        )}

        {/* Results table */}
        <div className="flex-1 overflow-auto">
          {!activeResult && !queryLoading && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-gray-500">Select a table or run a query</p>
            </div>
          )}

          {queryLoading && (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-gray-500">Running query...</p>
            </div>
          )}

          {activeResult && activeResult.rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900/95">
                <tr>
                  {activeResult.columns.map(col => (
                    <th key={col} className="text-left px-3 py-2 text-gray-500 font-medium border-b border-white/10 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeResult.rows.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    {activeResult.columns.map(col => (
                      <td key={col} className="px-3 py-2 text-gray-300 max-w-xs truncate">
                        {row[col] === null ? <span className="text-gray-600 italic">null</span> : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeResult && activeResult.rows.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-gray-500">No rows returned</p>
            </div>
          )}
        </div>

        {/* Footer status */}
        {activeResult && (
          <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between bg-slate-950/50">
            <span className="text-[11px] text-gray-500">
              {activeResult.rowCount} row{activeResult.rowCount !== 1 ? 's' : ''} returned
              {activeResult.columns.length > 0 && ` \u00b7 ${activeResult.columns.length} columns`}
            </span>
            <span className="text-[10px] text-gray-600 font-mono">{selectedDb}</span>
          </div>
        )}
      </div>
    </div>
  );
}
