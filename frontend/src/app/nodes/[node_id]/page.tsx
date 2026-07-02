"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { 
  Server, Shield, RefreshCw, Cpu, Database, Network, 
  Terminal, Activity, ArrowLeft, Heart, Play, AlertTriangle, CheckCircle, Clock,
  ArrowUp, ArrowDown, ChevronRight, HardDrive, Cpu as CpuIcon, Layers, Radio
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, AreaChart, Area, CartesianGrid, Legend
} from "recharts";

interface Process {
  pid: number;
  name: string;
  threads: number;
  cpu: number;
  memory: number;
  status: string;
  parent_pid?: number;
  thread_ids?: string[];
}

interface ThreadStats {
  total_processes: number;
  total_threads: number;
  running_threads: number;
  sleeping_threads: number;
  zombies: number;
  processes: Process[];
}

interface Node {
  id: string;
  hostname: string;
  ip_address: string;
  role: string;
  status: string;
  os: string;
  kernel: string;
  arch: string;
  docker_version: string;
  cpu_cores: number;
  total_memory: number;
  uptime?: string;
  last_heartbeat?: string;
  latency: number;
  container_id?: string;
  
  // Real-time metric cache
  cpu_usage?: number;
  memory_used?: number;
  memory_free?: number;
  disk_used?: number;
  disk_free?: number;
  net_send?: number;
  net_recv?: number;

  system_info?: {
    machine_name?: string;
    processor?: string;
    python_version?: string;
    mac_address?: string;
    boot_time?: string;
  };
  detailed_metrics?: {
    per_core_cpu?: number[];
    cpu_freq?: { current: number; min: number; max: number };
    cpu_temp?: number;
    load_avg?: number[];
    swap_total?: number;
    swap_used?: number;
    swap_free?: number;
    swap_percent?: number;
    disk_partitions?: any[];
    disk_read_speed?: number;
    disk_write_speed?: number;
    net_packets_sent?: number;
    net_packets_recv?: number;
    net_speed_sent?: number;
    net_speed_recv?: number;
    interfaces?: any[];
  };
}

export default function NodeDetailPage({ params }: { params: { node_id: string } }) {
  const nodeId = params.node_id;

  const [node, setNode] = useState<Node | null>(null);
  const [threadStats, setThreadStats] = useState<ThreadStats>({
    total_processes: 0,
    total_threads: 0,
    running_threads: 0,
    sleeping_threads: 0,
    zombies: 0,
    processes: []
  });
  const [history, setHistory] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [apiUrls, setApiUrls] = useState<{ rest: string; ws: string } | null>(null);
  
  // UI Tabs / Navigation
  const [activeSection, setActiveSection] = useState<string>("overview");
  
  // Search & Filter processes
  const [searchProcess, setSearchProcess] = useState<string>("");
  const [sortField, setSortField] = useState<keyof Process>("cpu");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      const port = window.location.port === "3000" ? "8000" : window.location.port;
      setApiUrls({
        rest: `http://${host}:${port || "8000"}/api/v1`,
        ws: `ws://${host}:${port || "8000"}/ws`
      });
    }
  }, []);

  const fetchNodeDetails = async () => {
    if (!apiUrls) return;
    try {
      // Use extended V2 detailed api
      const res = await fetch(`${apiUrls.rest}/node/${nodeId}`);
      if (res.status === 404) return;
      const data: Node = await res.json();
      setNode(data);
    } catch (err) {
      console.error("Error fetching node details:", err);
    }
  };

  const fetchThreads = async () => {
    if (!apiUrls) return;
    try {
      const res = await fetch(`${apiUrls.rest}/node/${nodeId}/threads`);
      if (res.status === 404) return;
      const data: ThreadStats = await res.json();
      setThreadStats(data);
    } catch (err) {
      console.error("Error fetching thread stats:", err);
    }
  };

  const fetchHistory = async () => {
    if (!apiUrls) return;
    try {
      const res = await fetch(`${apiUrls.rest}/history?node_id=${nodeId}&limit=30`);
      const histData = await res.json();
      if (histData && histData.length > 0) {
        const formatted = histData.map((h: any) => {
          const total_ram = h.memory_used + h.memory_free;
          const ram_pct = total_ram > 0 ? (h.memory_used / total_ram) * 100 : 0;
          const total_disk = h.disk_used + h.disk_free;
          const disk_pct = total_disk > 0 ? (h.disk_used / total_disk) * 100 : 0;
          return {
            cpu: h.cpu_usage,
            ram: ram_pct,
            disk: disk_pct,
            net_tx: h.net_send,
            net_rx: h.net_recv,
            threads: h.total_threads || 0,
            time: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          };
        });
        setHistory(formatted);
      }
    } catch (err) {
      console.error("Error fetching node metric history:", err);
    }
  };

  useEffect(() => {
    if (!apiUrls) return;
    
    fetchNodeDetails();
    fetchThreads();
    fetchHistory();

    // Auto-refresh thread lists every 4 seconds
    const interval = setInterval(() => {
      fetchThreads();
    }, 4000);

    return () => clearInterval(interval);
  }, [apiUrls]);

  // WebSocket broker connection
  useEffect(() => {
    if (!apiUrls) return;

    const connectWS = () => {
      if (wsRef.current) wsRef.current.close();
      const ws = new WebSocket(apiUrls.ws);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { event: eventName, data } = msg;

          if (data && data.node_id === nodeId) {
            if (eventName === "metrics_update") {
              setNode(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  status: "online",
                  last_heartbeat: data.last_heartbeat,
                  cpu_usage: data.cpu_usage,
                  memory_used: data.memory_used,
                  memory_free: data.memory_free,
                  disk_used: data.disk_used,
                  disk_free: data.disk_free,
                  net_send: data.net_send,
                  net_recv: data.net_recv,
                  uptime: data.uptime,
                  detailed_metrics: data.detailed_metrics
                };
              });

              // Update history live
              setHistory(prev => {
                const total_ram = data.memory_used + data.memory_free;
                const ram_pct = total_ram > 0 ? (data.memory_used / total_ram) * 100 : 0;
                
                let diskPercent = 0;
                if (data.detailed_metrics && data.detailed_metrics.disk_partitions && data.detailed_metrics.disk_partitions.length > 0) {
                  diskPercent = data.detailed_metrics.disk_partitions[0].percent || 0;
                } else {
                  const totalDisk = (data.disk_used || 0) + (data.disk_free || 0);
                  diskPercent = totalDisk > 0 ? (data.disk_used / totalDisk) * 100 : 0;
                }

                const newHistItem = {
                  cpu: data.cpu_usage,
                  ram: ram_pct,
                  disk: diskPercent,
                  net_tx: data.detailed_metrics?.disk_read_speed || data.net_send || 0, // Fallback speed
                  net_rx: data.detailed_metrics?.disk_write_speed || data.net_recv || 0,
                  threads: data.total_threads || 0,
                  time: new Date(data.last_heartbeat).toLocaleTimeString([], { second: '2-digit' }) + "s"
                };
                
                const updated = [...prev, newHistItem];
                if (updated.length > 30) updated.shift();
                return updated;
              });
            }

            else if (eventName === "heartbeat") {
              setNode(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  status: "online",
                  latency: data.latency,
                  last_heartbeat: data.timestamp
                };
              });
            }

            else if (eventName === "node_status_change") {
              setNode(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  status: data.status,
                  last_heartbeat: data.timestamp
                };
              });
            }
          }
        } catch (e) {
          console.error("Error in node detail ws message handler:", e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connectWS, 4000);
      };
    };

    connectWS();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [apiUrls]);

  if (!node) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading node specifications...</p>
        </div>
      </div>
    );
  }

  const formatBytes = (bytes: number, decimals = 1) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const isOnline = node.status === "online";
  const sys = node.system_info || {};
  const det = node.detailed_metrics || {};

  // Sort and filter processes
  const filteredProcesses = threadStats.processes
    .filter(p => p.name.toLowerCase().includes(searchProcess.toLowerCase()) || p.pid.toString().includes(searchProcess))
    .sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

  const handleSort = (field: keyof Process) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

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
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Node Details</span>
                <ChevronRight className="h-3 w-3 text-gray-600" />
                <h1 className="text-base font-bold text-white flex items-center gap-1.5">
                  {node.hostname}
                </h1>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border text-xs">
              <div className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-success animate-pulse" : "bg-destructive"}`} />
              <span className="text-gray-400">Node Status:</span>
              <span className="font-semibold text-white">{isOnline ? "Online" : "Offline"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout Grid with sticky sidebar */}
      <div className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Navigation Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-card/40 border border-border rounded-2xl p-4 space-y-1.5 sticky top-24">
            <button
              onClick={() => setActiveSection("overview")}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
                activeSection === "overview" ? "bg-primary text-white" : "text-gray-400 hover:bg-secondary/40 hover:text-white"
              }`}
            >
              <CpuIcon className="h-4 w-4" />
              System Specs
            </button>
            <button
              onClick={() => setActiveSection("cpu-mem")}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
                activeSection === "cpu-mem" ? "bg-primary text-white" : "text-gray-400 hover:bg-secondary/40 hover:text-white"
              }`}
            >
              <Cpu className="h-4 w-4" />
              CPU & Memory Details
            </button>
            <button
              onClick={() => setActiveSection("storage")}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
                activeSection === "storage" ? "bg-primary text-white" : "text-gray-400 hover:bg-secondary/40 hover:text-white"
              }`}
            >
              <HardDrive className="h-4 w-4" />
              Disk & Network Details
            </button>
            <button
              onClick={() => setActiveSection("threads")}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
                activeSection === "threads" ? "bg-primary text-white" : "text-gray-400 hover:bg-secondary/40 hover:text-white"
              }`}
            >
              <Layers className="h-4 w-4" />
              Threads & Processes
            </button>
            <button
              onClick={() => setActiveSection("charts")}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all ${
                activeSection === "charts" ? "bg-primary text-white" : "text-gray-400 hover:bg-secondary/40 hover:text-white"
              }`}
            >
              <Activity className="h-4 w-4" />
              Historical Charts
            </button>
          </div>
        </div>

        {/* Content sections */}
        <div className="lg:col-span-3 space-y-8">
          
          {/* SECTION 1: SYSTEM OVERVIEW SPECS */}
          {activeSection === "overview" && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CpuIcon className="h-5 w-5 text-primary" />
                System Information
              </h2>
              
              <div className="bg-card/30 border border-border rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                <SpecItem label="Hostname" value={node.hostname} />
                <SpecItem label="Operating System" value={node.os} />
                <SpecItem label="Kernel Version" value={node.kernel} />
                <SpecItem label="Architecture" value={node.arch} />
                <SpecItem label="Machine Name" value={sys.machine_name || "N/A"} />
                <SpecItem label="Processor" value={sys.processor || "N/A"} />
                <SpecItem label="Docker version" value={node.docker_version} />
                <SpecItem label="Python version" value={sys.python_version || "N/A"} />
                <SpecItem label="IP Address" value={node.ip_address} />
                <SpecItem label="MAC Address" value={sys.mac_address || "N/A"} />
                <SpecItem label="Container ID" value={node.container_id || "N/A"} />
                <SpecItem label="System Boot Time" value={sys.boot_time ? new Date(sys.boot_time).toLocaleString() : "N/A"} />
                <SpecItem label="Node Uptime" value={node.uptime ? new Date(node.uptime).toLocaleString() : "N/A"} />
              </div>
            </div>
          )}

          {/* SECTION 2: CPU & MEMORY DETAIL GAUGE */}
          {activeSection === "cpu-mem" && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                CPU & Memory Configuration
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* CPU stats */}
                <div className="bg-card/30 border border-border rounded-2xl p-6 space-y-4">
                  <h3 className="font-bold text-white text-sm">Processor Core Usage</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <SpecItem label="Logical Cores" value={node.cpu_cores.toString()} />
                    <SpecItem label="Physical Cores" value={node.cpu_cores.toString()} />
                    <SpecItem label="Current Frequency" value={det.cpu_freq ? `${det.cpu_freq.current.toFixed(1)} MHz` : "N/A"} />
                    <SpecItem label="Load Average" value={det.load_avg ? det.load_avg.map(l => l.toFixed(2)).join(" / ") : "N/A"} />
                    <SpecItem label="CPU Temperature" value={det.cpu_temp ? `${det.cpu_temp.toFixed(1)} °C` : "Not available"} />
                  </div>

                  {/* Per Core progress bars */}
                  {det.per_core_cpu && det.per_core_cpu.length > 0 && (
                    <div className="pt-4 border-t border-border/40 space-y-2">
                      <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Per-Core CPU Usage</span>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                        {det.per_core_cpu.map((core, i) => (
                          <div key={i}>
                            <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                              <span>Core {i}</span>
                              <span className="text-white">{core}%</span>
                            </div>
                            <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                              <div className="bg-blue-500 h-full" style={{ width: `${core}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Memory details */}
                <div className="bg-card/30 border border-border rounded-2xl p-6 space-y-4">
                  <h3 className="font-bold text-white text-sm">RAM & Swap Memory</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <SpecItem label="Total RAM" value={formatBytes(node.total_memory)} />
                    <SpecItem label="Used RAM" value={formatBytes(node.memory_used || 0)} />
                    <SpecItem label="Free RAM" value={formatBytes(node.memory_free || 0)} />
                    <SpecItem label="Swap Total" value={det.swap_total ? formatBytes(det.swap_total) : "N/A"} />
                    <SpecItem label="Swap Used" value={det.swap_used ? formatBytes(det.swap_used) : "N/A"} />
                    <SpecItem label="Swap Free" value={det.swap_free ? formatBytes(det.swap_free) : "N/A"} />
                  </div>

                  <div className="pt-4 border-t border-border/40 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>RAM Utilization</span>
                        <span className="text-white font-semibold">
                          {((node.memory_used || 0) / (node.total_memory || 1) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-purple-500 h-full" 
                          style={{ width: `${((node.memory_used || 0) / (node.total_memory || 1) * 100)}%` }} 
                        />
                      </div>
                    </div>

                    {det.swap_total ? (
                      <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Swap Utilization</span>
                          <span className="text-white font-semibold">{det.swap_percent?.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-pink-500 h-full" 
                            style={{ width: `${det.swap_percent}%` }} 
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* SECTION 3: STORAGE & NETWORK */}
          {activeSection === "storage" && (
            <div className="space-y-6">
              
              {/* Partitions detail */}
              <div className="bg-card/30 border border-border rounded-2xl p-6 space-y-4">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-primary" />
                  Disk Partitions & Speeds
                </h2>
                
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-border/40">
                  <SpecItem label="Disk Read Speed" value={det.disk_read_speed ? `${formatBytes(det.disk_read_speed)}/s` : "0 Bytes/s"} />
                  <SpecItem label="Disk Write Speed" value={det.disk_write_speed ? `${formatBytes(det.disk_write_speed)}/s` : "0 Bytes/s"} />
                  <SpecItem label="Disk Health" value="Healthy" />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border text-gray-500 font-medium">
                        <th className="pb-2">Mount</th>
                        <th className="pb-2">Device</th>
                        <th className="pb-2">FS Type</th>
                        <th className="pb-2">Used</th>
                        <th className="pb-2">Total</th>
                        <th className="pb-2 pr-2 text-right">Percent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {det.disk_partitions && det.disk_partitions.map((part, i) => (
                        <tr key={i} className="hover:bg-white/[0.01]">
                          <td className="py-2.5 font-bold text-white">{part.mountpoint}</td>
                          <td className="py-2.5 text-gray-500 font-mono">{part.device}</td>
                          <td className="py-2.5 text-gray-400">{part.fstype}</td>
                          <td className="py-2.5 text-white">{formatBytes(part.used)}</td>
                          <td className="py-2.5 text-white">{formatBytes(part.total)}</td>
                          <td className="py-2.5 pr-2 text-right">
                            <span className="font-semibold text-white">{part.percent}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Connected network interfaces */}
              <div className="bg-card/30 border border-border rounded-2xl p-6 space-y-4">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Radio className="h-5 w-5 text-primary" />
                  Network Interfaces & Bandwidth
                </h2>

                <div className="grid grid-cols-4 gap-4 pb-4 border-b border-border/40">
                  <SpecItem label="Bytes Sent" value={formatBytes(node.net_send || 0)} />
                  <SpecItem label="Bytes Received" value={formatBytes(node.net_recv || 0)} />
                  <SpecItem label="TX Speed" value={det.net_speed_sent ? `${formatBytes(det.net_speed_sent)}/s` : "0 Bytes/s"} />
                  <SpecItem label="RX Speed" value={det.net_speed_recv ? `${formatBytes(det.net_speed_recv)}/s` : "0 Bytes/s"} />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border text-gray-500 font-medium">
                        <th className="pb-2">Interface</th>
                        <th className="pb-2">State</th>
                        <th className="pb-2">Speed</th>
                        <th className="pb-2 pr-2">IP Addresses</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {det.interfaces && det.interfaces.map((intf, i) => (
                        <tr key={i} className="hover:bg-white/[0.01]">
                          <td className="py-2.5 font-bold text-white">{intf.name}</td>
                          <td className="py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              intf.is_up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                            }`}>
                              {intf.is_up ? "UP" : "DOWN"}
                            </span>
                          </td>
                          <td className="py-2.5 text-gray-400 font-mono">{intf.speed} Mbps</td>
                          <td className="py-2.5 pr-2 font-mono text-gray-500 text-[10px] max-w-xs truncate" title={intf.addresses.join(', ')}>
                            {intf.addresses.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* SECTION 4: THREADS & PROCESS LIST */}
          {activeSection === "threads" && (
            <div className="space-y-6">
              
              {/* Aggregates */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-card/40 border border-border rounded-xl p-4">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">Total Processes</span>
                  <span className="text-xl font-bold text-white mt-1 block">{threadStats.total_processes}</span>
                </div>
                <div className="bg-card/40 border border-border rounded-xl p-4">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">Total Threads</span>
                  <span className="text-xl font-bold text-white mt-1 block">{threadStats.total_threads}</span>
                </div>
                <div className="bg-card/40 border border-border rounded-xl p-4">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">Running Threads</span>
                  <span className="text-xl font-bold text-success mt-1 block">{threadStats.running_threads}</span>
                </div>
                <div className="bg-card/40 border border-border rounded-xl p-4">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">Sleeping Threads</span>
                  <span className="text-xl font-bold text-blue-400 mt-1 block">{threadStats.sleeping_threads}</span>
                </div>
                <div className="bg-card/40 border border-border rounded-xl p-4">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">Zombies</span>
                  <span className={`text-xl font-bold mt-1 block ${threadStats.zombies > 0 ? "text-destructive" : "text-gray-400"}`}>
                    {threadStats.zombies}
                  </span>
                </div>
              </div>

              {/* Processes Table Grid */}
              <div className="bg-card/30 border border-border rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center gap-4">
                  <h3 className="font-bold text-white text-sm">Thread & Process Monitor</h3>
                  <input 
                    type="text"
                    placeholder="Search PID or process name..."
                    value={searchProcess}
                    onChange={(e) => setSearchProcess(e.target.value)}
                    className="bg-secondary border border-border rounded-lg text-xs px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-primary w-60"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border text-gray-400 font-semibold cursor-pointer select-none">
                        <th className="pb-3 pl-2" onClick={() => handleSort("pid")}>PID {sortField === "pid" && (sortAsc ? "▲" : "▼")}</th>
                        <th className="pb-3" onClick={() => handleSort("name")}>Process Name {sortField === "name" && (sortAsc ? "▲" : "▼")}</th>
                        <th className="pb-3 text-right" onClick={() => handleSort("threads")}>Threads {sortField === "threads" && (sortAsc ? "▲" : "▼")}</th>
                        <th className="pb-3 text-right" onClick={() => handleSort("cpu")}>CPU % {sortField === "cpu" && (sortAsc ? "▲" : "▼")}</th>
                        <th className="pb-3 text-right" onClick={() => handleSort("memory")}>Memory % {sortField === "memory" && (sortAsc ? "▲" : "▼")}</th>
                        <th className="pb-3 pl-4" onClick={() => handleSort("status")}>Status {sortField === "status" && (sortAsc ? "▲" : "▼")}</th>
                        <th className="pb-3 pr-2 text-right">Parent PID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                      {filteredProcesses.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-gray-500 font-sans">
                            No matching processes running.
                          </td>
                        </tr>
                      ) : (
                        filteredProcesses.map((proc, i) => (
                          <tr key={i} className="hover:bg-white/[0.02]">
                            <td className="py-2.5 pl-2 text-white font-bold">{proc.pid}</td>
                            <td className="py-2.5 text-white font-sans font-medium" title={`Thread IDs: ${proc.thread_ids?.join(', ') || 'None'}`}>{proc.name}</td>
                            <td className="py-2.5 text-right text-gray-300 font-bold">{proc.threads}</td>
                            <td className="py-2.5 text-right text-success font-bold">{proc.cpu}%</td>
                            <td className="py-2.5 text-right text-blue-400">{proc.memory}%</td>
                            <td className="py-2.5 pl-4">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                proc.status.toLowerCase() === "running" ? "bg-success/15 text-success" : "bg-secondary text-gray-400"
                              }`}>
                                {proc.status}
                              </span>
                            </td>
                            <td className="py-2.5 pr-2 text-right text-gray-500">{proc.parent_pid || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* SECTION 5: RESOURCE VISUALIZATION HISTORICAL TIMELINES */}
          {activeSection === "charts" && (
            <div className="space-y-8">
              
              {/* CPU Timeline */}
              <div className="bg-card/30 border border-border rounded-2xl p-6">
                <h3 className="text-sm font-bold text-white mb-4">CPU Usage Timeline (%)</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="cpu-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="#555" fontSize={10} />
                      <YAxis stroke="#555" fontSize={10} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#0e0e11", border: "1px solid #232329" }} />
                      <Area type="monotone" dataKey="cpu" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#cpu-grad)" name="CPU %" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* RAM Timeline */}
              <div className="bg-card/30 border border-border rounded-2xl p-6">
                <h3 className="text-sm font-bold text-white mb-4">RAM Allocation Timeline (%)</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="ram-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="#555" fontSize={10} />
                      <YAxis stroke="#555" fontSize={10} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#0e0e11", border: "1px solid #232329" }} />
                      <Area type="monotone" dataKey="ram" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#ram-grad)" name="RAM %" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Disk usage Timeline */}
              <div className="bg-card/30 border border-border rounded-2xl p-6">
                <h3 className="text-sm font-bold text-white mb-4">Disk Usage Timeline (%)</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="disk-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="#555" fontSize={10} />
                      <YAxis stroke="#555" fontSize={10} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "#0e0e11", border: "1px solid #232329" }} />
                      <Area type="monotone" dataKey="disk" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#disk-grad)" name="Disk %" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Network Timeline */}
              <div className="bg-card/30 border border-border rounded-2xl p-6">
                <h3 className="text-sm font-bold text-white mb-4">Network Speed Timeline (Bytes/s)</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="#555" fontSize={10} />
                      <YAxis stroke="#555" fontSize={10} />
                      <Tooltip contentStyle={{ background: "#0e0e11", border: "1px solid #232329" }} />
                      <Legend verticalAlign="top" height={36} />
                      <Line type="monotone" dataKey="net_tx" stroke="#ef4444" strokeWidth={2} dot={false} name="Network TX" />
                      <Line type="monotone" dataKey="net_rx" stroke="#10b981" strokeWidth={2} dot={false} name="Network RX" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Thread count Timeline */}
              <div className="bg-card/30 border border-border rounded-2xl p-6">
                <h3 className="text-sm font-bold text-white mb-4">Thread Count Timeline</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="threads-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="#555" fontSize={10} />
                      <YAxis stroke="#555" fontSize={10} />
                      <Tooltip contentStyle={{ background: "#0e0e11", border: "1px solid #232329" }} />
                      <Area type="monotone" dataKey="threads" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#threads-grad)" name="Total Threads" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}

function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2 border-b border-border/20 flex justify-between text-xs">
      <span className="text-gray-400">{label}:</span>
      <span className="text-white font-medium text-right max-w-xs truncate">{value}</span>
    </div>
  );
}
