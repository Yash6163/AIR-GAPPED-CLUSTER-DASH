"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  Database, RefreshCw, Download, Search, ChevronLeft, ChevronRight, 
  ArrowLeft, FileText, Settings, Loader2, ArrowUpDown
} from "lucide-react";

interface TableInfo {
  name: string;
  table: string;
  description: string;
}

interface TableDataResponse {
  columns: { field: string; type: string }[];
  rows: Record<string, any>[];
  total: number;
  page: number;
  page_size: number;
}

export default function DatabaseViewerPage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [activeTable, setActiveTable] = useState<string>("nodes");
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  
  // Grid parameters
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("");
  const [sortDesc, setSortDesc] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(15);
  const [loading, setLoading] = useState<boolean>(false);

  const [apiUrls, setApiUrls] = useState<{ rest: string } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      const port = window.location.port === "3000" ? "8000" : window.location.port;
      setApiUrls({
        rest: `http://${host}:${port || "8000"}/api/v1`
      });
    }
  }, []);

  const fetchTables = async () => {
    if (!apiUrls) return;
    try {
      const res = await fetch(`${apiUrls.rest}/database/tables`);
      const data = await res.json();
      setTables(data);
      if (data.length > 0) {
        setActiveTable(data[0].table);
      }
    } catch (err) {
      console.error("Failed to load tables list:", err);
    }
  };

  const fetchTableData = async () => {
    if (!apiUrls || !activeTable) return;
    setLoading(true);
    try {
      let url = `${apiUrls.rest}/database/explorer/${activeTable}?page=${page}&page_size=${pageSize}`;
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      if (sortBy) {
        url += `&sort_by=${sortBy}&sort_desc=${sortDesc}`;
      }
      
      const res = await fetch(url);
      const data = await res.json();
      setTableData(data);
    } catch (err) {
      console.error("Failed to load table rows:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!apiUrls) return;
    fetchTables();
  }, [apiUrls]);

  useEffect(() => {
    if (!apiUrls || !activeTable) return;
    setPage(1);
    fetchTableData();
  }, [activeTable]);

  useEffect(() => {
    if (!apiUrls || !activeTable) return;
    fetchTableData();
  }, [page, sortBy, sortDesc]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchTableData();
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      setSortDesc(false);
    }
  };

  const handleExport = () => {
    if (!apiUrls || !activeTable) return;
    const exportUrl = `${apiUrls.rest}/database/export?table=${activeTable}`;
    window.open(exportUrl, "_blank");
  };

  const totalPages = tableData ? Math.ceil(tableData.total / pageSize) : 1;

  return (
    <div className="min-h-screen bg-background text-foreground cyber-grid pb-16">
      
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white transition-colors bg-secondary border border-border px-3 py-1.5 rounded-lg font-sans">
              <ArrowLeft className="h-3.5 w-3.5" />
              Overview
            </Link>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <h1 className="text-base font-bold text-white">PostgreSQL Database Viewer</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Sidebar: Database tables */}
        <div className="lg:col-span-1">
          <div className="bg-card/40 border border-border rounded-2xl p-4 space-y-3">
            <div>
              <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider px-3 mb-2">Relational Tables</h3>
              <div className="space-y-1">
                {tables.map((tbl) => (
                  <button
                    key={tbl.table}
                    onClick={() => setActiveTable(tbl.table)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs flex flex-col transition-all ${
                      activeTable === tbl.table 
                        ? "bg-primary text-white" 
                        : "text-gray-400 hover:bg-secondary/40 hover:text-white"
                    }`}
                  >
                    <span className="font-bold flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" />
                      {tbl.name}
                    </span>
                    <span className={`text-[10px] mt-0.5 font-normal ${activeTable === tbl.table ? "text-white/80" : "text-gray-500"}`}>
                      {tbl.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Datagrid content */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-card/30 border border-border rounded-2xl p-6 space-y-4">
            
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white uppercase tracking-wider">{activeTable}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Showing {tableData ? tableData.rows.length : 0} rows of {tableData ? tableData.total : 0} total
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <form onSubmit={handleSearch} className="flex items-center relative">
                  <input 
                    type="text" 
                    placeholder="Search database row..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="bg-secondary border border-border rounded-lg text-xs pl-8 pr-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-primary w-52"
                  />
                  <Search className="h-3.5 w-3.5 text-gray-500 absolute left-2.5" />
                </form>

                {/* Actions */}
                <button
                  onClick={fetchTableData}
                  className="p-1.5 rounded-lg bg-secondary hover:bg-accent border border-border text-gray-400 hover:text-white transition-colors"
                  title="Reload table"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                
                <button
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-success/20 hover:bg-success border border-success/30 rounded-lg text-xs font-semibold text-success hover:text-white transition-all"
                  title="Export table as CSV"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV Export
                </button>
              </div>
            </div>

            {/* Datagrid list */}
            {loading ? (
              <div className="py-24 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              </div>
            ) : tableData && tableData.rows.length > 0 ? (
              <div className="space-y-4">
                <div className="overflow-x-auto max-h-[500px] border border-border/40 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#0b0b0f] sticky top-0 z-10 border-b border-border/60">
                      <tr>
                        {tableData.columns.map((col) => (
                          <th 
                            key={col.field} 
                            onClick={() => toggleSort(col.field)}
                            className="p-3 font-semibold text-gray-400 hover:text-white transition-colors cursor-pointer select-none font-mono text-[10px]"
                          >
                            <span className="flex items-center gap-1">
                              {col.field}
                              <ArrowUpDown className="h-3 w-3 text-gray-600" />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30 font-mono text-[11px]">
                      {tableData.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-white/[0.02] even:bg-white/[0.005]">
                          {tableData.columns.map((col) => {
                            const val = row[col.field];
                            let displayVal = "";
                            if (val === null || val === undefined) {
                              displayVal = "NULL";
                            } else if (typeof val === "object") {
                              displayVal = JSON.stringify(val);
                            } else {
                              displayVal = val.toString();
                            }
                            return (
                              <td 
                                key={col.field} 
                                className={`p-3 truncate max-w-xs ${
                                  val === null ? "text-gray-600 italic" : "text-white"
                                }`} 
                                title={displayVal}
                              >
                                {displayVal}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between border-t border-border/40 pt-4 text-xs text-gray-400">
                  <span>
                    Page <strong>{page}</strong> of <strong>{totalPages || 1}</strong>
                  </span>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="p-1.5 rounded bg-secondary hover:bg-accent disabled:opacity-50 text-white transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="p-1.5 rounded bg-secondary hover:bg-accent disabled:opacity-50 text-white transition-colors"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-24 text-center text-gray-500 font-sans">
                <FileText className="h-10 w-10 text-gray-600 mx-auto mb-2" />
                <h4 className="font-bold text-white">Empty database table</h4>
                <p className="text-xs text-gray-500 mt-1">No rows matching current search query found.</p>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}
