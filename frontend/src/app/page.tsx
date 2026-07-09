"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { 
  Server, Shield, RefreshCw, Cpu, Database, Network, 
  HardDrive, Terminal, Play, Square, Activity, Bell, 
  AlertTriangle, CheckCircle, Clock, ArrowUp, ArrowDown, ChevronRight, X
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, AreaChart, Area
} from "recharts";

// --- Types conforming to Domain Schema ---

interface ContainerMetric {
  container_id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  cpu_usage: number;
  memory_usage: number;
  restart_count: number;
  started_at: string;
}

interface Node {
  id: string;
  hostname: string;
  ip_address: string;
  role: string;
  status: string; // "online" | "offline"
  os: string;
  kernel: string;
  arch: string;
  docker_version: string;
  cpu_cores: number;
  total_memory: number;
  uptime?: string;
  last_heartbeat?: string;
  latency: number;
  
  // Real-time parsed metrics
  cpu_usage?: number;
  memory_used?: number;
  memory_free?: number;
  disk_used?: number;
  disk_free?: number;
  net_send?: number;
  net_recv?: number;
  containers?: ContainerMetric[];
  detailed_metrics?: any;
  
  // Historical logs for sparklines
  history?: { cpu: number; ram: number; time: string }[];
}

interface Alert {
  id: number;
  node_id: string;
  node_hostname?: string;
  type: string;
  severity: string;
  message: string;
  timestamp: string;
  resolved: boolean;
}

interface ClusterOverview {
  total_nodes: number;
  online_nodes: number;
  offline_nodes: number;
  manager_nodes: number;
  worker_nodes: number;
  total_cpu_cores: number;
  total_memory: number;
  status: string;
}

export default function Dashboard() {
  // State variables
  const [nodes, setNodes] = useState<Record<string, Node>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [clusterStats, setClusterStats] = useState<ClusterOverview>({
    total_nodes: 0,
    online_nodes: 0,
    offline_nodes: 0,
    manager_nodes: 0,
    worker_nodes: 0,
    total_cpu_cores: 0,
    total_memory: 0,
    status: "degraded",
  });
  
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchContainer, setSearchContainer] = useState<string>("");
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string; logs: string[] } | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Dynamic REST/WS URLs
  const [apiUrls, setApiUrls] = useState<{ rest: string; ws: string } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      // If run on localhost port 3000, fallback to port 8000 for backend
      const port = window.location.port === "3000" ? "8000" : window.location.port;
      setApiUrls({
        rest: `http://${host}:${port || "8000"}/api/v1`,
        ws: `ws://${host}:${port || "8000"}/ws`
      });
    }
  }, []);

  // Fetch initial REST data
  useEffect(() => {
    if (!apiUrls) return;

    const bootstrapData = async () => {
      try {
        // Fetch nodes list
        const nodesRes = await fetch(`${apiUrls.rest}/nodes`);
        const nodesData: Node[] = await nodesRes.json();
        
        // Fetch initial overview
        const clusterRes = await fetch(`${apiUrls.rest}/cluster`);
        const clusterData: ClusterOverview = await clusterRes.json();
        setClusterStats(clusterData);

        // Fetch unresolved alerts
        const alertsRes = await fetch(`${apiUrls.rest}/alerts?unresolved_only=false`);
        const alertsData: Alert[] = await alertsRes.json();
        setAlerts(alertsData);

        // Convert list of nodes to Record dictionary & load initial history
        const nodeRecords: Record<string, Node> = {};
        for (const n of nodesData) {
          nodeRecords[n.id] = {
            ...n,
            cpu_usage: 0,
            memory_used: 0,
            memory_free: n.total_memory,
            disk_used: 0,
            disk_free: 0,
            net_send: 0,
            net_recv: 0,
            containers: [],
            history: Array.from({ length: 15 }, (_, i) => ({ cpu: 0, ram: 0, time: `${i}s` })),
          };
          
          // Seed history metrics for graphs
          try {
            const histRes = await fetch(`${apiUrls.rest}/history?node_id=${n.id}&limit=15`);
            const histData = await histRes.json();
            if (histData && histData.length > 0) {
              nodeRecords[n.id].history = histData.map((h: any, index: number) => {
                const total_ram = h.memory_used + h.memory_free;
                const ram_pct = total_ram > 0 ? (h.memory_used / total_ram) * 100 : 0;
                return {
                  cpu: h.cpu_usage,
                  ram: ram_pct,
                  time: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                };
              });
              // Seed the latest metric
              const latest = histData[histData.length - 1];
              nodeRecords[n.id].cpu_usage = latest.cpu_usage;
              nodeRecords[n.id].memory_used = latest.memory_used;
              nodeRecords[n.id].memory_free = latest.memory_free;
              nodeRecords[n.id].disk_used = latest.disk_used;
              nodeRecords[n.id].disk_free = latest.disk_free;
              nodeRecords[n.id].net_send = latest.net_send;
              nodeRecords[n.id].net_recv = latest.net_recv;
            }
          } catch (err) {
            console.error(`Failed to load historical graphs for node ${n.id}:`, err);
          }
        }
        
        // Fetch active containers
        try {
          const containersRes = await fetch(`${apiUrls.rest}/containers`);
          const containersData = await containersRes.json();
          containersData.forEach((c: any) => {
            if (nodeRecords[c.node_id]) {
              if (!nodeRecords[c.node_id].containers) {
                nodeRecords[c.node_id].containers = [];
              }
              nodeRecords[c.node_id].containers!.push(c);
            }
          });
        } catch (cErr) {
          console.error("Failed loading container list:", cErr);
        }

        setNodes(nodeRecords);
      } catch (err) {
        console.error("Bootstrap API loading failed:", err);
      }
    };

    bootstrapData();
  }, [apiUrls]);

  // WebSocket listener
  useEffect(() => {
    if (!apiUrls) return;

    const connectWS = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      console.log("Connecting to WebSocket Broker at:", apiUrls.ws);
      const ws = new WebSocket(apiUrls.ws);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        console.log("WebSocket broker connected.");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { event: eventName, data } = msg;

          if (eventName === "metrics_update") {
            setNodes((prev) => {
              const node = prev[data.node_id];
              if (!node) return prev;
              
              const total_mem = data.memory_used + data.memory_free;
              const ram_pct = total_mem > 0 ? (data.memory_used / total_mem) * 100 : 0;
              
              // Maintain moving window history of 15 elements
              const currentHistory = [...(node.history || [])];
              currentHistory.push({
                cpu: data.cpu_usage,
                ram: ram_pct,
                time: new Date(data.last_heartbeat).toLocaleTimeString([], { second: '2-digit' }) + "s",
              });
              if (currentHistory.length > 15) {
                currentHistory.shift();
              }

              return {
                ...prev,
                [data.node_id]: {
                  ...node,
                  cpu_usage: data.cpu_usage,
                  memory_used: data.memory_used,
                  memory_free: data.memory_free,
                  disk_used: data.disk_used,
                  disk_free: data.disk_free,
                  net_send: data.net_send,
                  net_recv: data.net_recv,
                  containers: data.containers,
                  uptime: data.uptime,
                  last_heartbeat: data.last_heartbeat,
                  history: currentHistory,
                  status: "online",
                }
              };
            });
          }

          else if (eventName === "heartbeat") {
            setNodes((prev) => {
              const node = prev[data.node_id];
              if (!node) return prev;
              return {
                ...prev,
                [data.node_id]: {
                  ...node,
                  latency: data.latency,
                  last_heartbeat: data.timestamp,
                  status: "online",
                }
              };
            });
          }

          else if (eventName === "node_status_change") {
            setNodes((prev) => {
              const node = prev[data.node_id];
              if (!node) return prev;
              return {
                ...prev,
                [data.node_id]: {
                  ...node,
                  status: data.status,
                  last_heartbeat: data.timestamp,
                }
              };
            });
            // Refresh cluster aggregate stats
            triggerStatsRefresh();
          }

          else if (eventName === "alert_triggered") {
            setAlerts((prev) => {
              // Avoid duplicates
              if (prev.some((a) => a.id === data.id)) return prev;
              return [data, ...prev];
            });
            triggerStatsRefresh();
          }

          else if (eventName === "alert_resolved") {
            setAlerts((prev) => 
              prev.map((a) => a.id === data.id || (a.node_id === data.node_id && a.type === data.type) ? { ...a, resolved: true } : a)
            );
            triggerStatsRefresh();
          }
        } catch (e) {
          console.error("Error processing websocket payload:", e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        console.log("WebSocket broker disconnected. Scheduling reconnection...");
        reconnectTimeoutRef.current = setTimeout(connectWS, 4000);
      };

      ws.onerror = (err) => {
        console.error("WebSocket client encountered error:", err);
        ws.close();
      };
    };

    connectWS();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [apiUrls]);

  // Periodic REST call to ensure database counters are in sync
  const triggerStatsRefresh = async () => {
    if (!apiUrls) return;
    try {
      const res = await fetch(`${apiUrls.rest}/cluster`);
      const data = await res.json();
      setClusterStats(data);
    } catch (e) {
      console.debug("Background stats sync failed:", e);
    }
  };

  useEffect(() => {
    const timer = setInterval(triggerStatsRefresh, 10000);
    return () => clearInterval(timer);
  }, [apiUrls]);

  // Format Helper bytes
  const formatBytes = (bytes: number, decimals = 1) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // Extract all containers for table representation
  const allContainers: (ContainerMetric & { nodeHostname: string; nodeId: string })[] = [];
  Object.values(nodes).forEach((n) => {
    if (n.containers && n.status === "online") {
      n.containers.forEach((c) => {
        allContainers.push({
          ...c,
          nodeHostname: n.hostname,
          nodeId: n.id,
        });
      });
    }
  });

  const filteredContainers = allContainers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchContainer.toLowerCase()) ||
      c.image.toLowerCase().includes(searchContainer.toLowerCase()) ||
      c.nodeHostname.toLowerCase().includes(searchContainer.toLowerCase())
  );

  // Mock terminal logs retrieval helper
  const openContainerLogs = (cId: string, name: string) => {
    // Generate some mock docker real-time logs
    const mockLogs = [
      `[${new Date().toISOString()}] Starting cluster service listener...`,
      `[${new Date().toISOString()}] Connection pool established with database.`,
      `[${new Date().toISOString()}] Listening on port 80. PID = 1`,
      `[${new Date().toISOString()}] GET /health - 200 OK - 2.11ms`,
      `[${new Date().toISOString()}] GET /metrics - 200 OK - 8.44ms`,
      `[${new Date().toISOString()}] Redis connection verification successful.`,
      `[${new Date().toISOString()}] Cache hit: node-agent-session-token`,
      `[${new Date().toISOString()}] Sync worker queue processing. Loop active.`,
    ];
    setSelectedContainer({ id: cId, name, logs: mockLogs });
  };

  // Convert nodes dictionary to array
  const nodeArray = Object.values(nodes);
  const managerNode = nodeArray.find((n) => n.role === "manager") || nodeArray[0];
  const workerNodes = nodeArray.filter((n) => n.id !== (managerNode?.id));

  // OS cluster metrics calculations
  const windowsNodes = nodeArray.filter(n => n.os?.toLowerCase() === "windows");
  const winTotal = windowsNodes.length;
  const winOnline = windowsNodes.filter(n => n.status === "online").length;
  const winOffline = winTotal - winOnline;
  
  let winCpuSum = 0;
  let winRamPctSum = 0;
  let winDiskPctSum = 0;
  let winOnlineWithMetrics = 0;
  let winLastHb: string | undefined = undefined;
  
  windowsNodes.forEach(n => {
    if (n.last_heartbeat) {
      if (!winLastHb || new Date(n.last_heartbeat) > new Date(winLastHb)) {
        winLastHb = n.last_heartbeat;
      }
    }
    if (n.status === "online") {
      winOnlineWithMetrics++;
      winCpuSum += n.cpu_usage || 0;
      const totalRam = n.total_memory || 0;
      const ramPct = totalRam > 0 ? ((n.memory_used || 0) / totalRam) * 100 : 0;
      winRamPctSum += ramPct;
      
      // Calculate disk pct
      const details = n.detailed_metrics as any;
      if (details && details.disk_partitions && details.disk_partitions.length > 0) {
        winDiskPctSum += details.disk_partitions[0].percent || 0;
      } else {
        const totalDisk = (n.disk_used || 0) + (n.disk_free || 0);
        winDiskPctSum += totalDisk > 0 ? (n.disk_used! / totalDisk) * 100 : 0;
      }
    }
  });
  
  const winCpuAvg = winOnlineWithMetrics > 0 ? Math.round(winCpuSum / winOnlineWithMetrics) : 0;
  const winRamAvg = winOnlineWithMetrics > 0 ? Math.round(winRamPctSum / winOnlineWithMetrics) : 0;
  const winDiskAvg = winOnlineWithMetrics > 0 ? Math.round(winDiskPctSum / winOnlineWithMetrics) : 0;

  const macNodes = nodeArray.filter(n => n.os?.toLowerCase() === "darwin" || n.os?.toLowerCase() === "mac" || n.os?.toLowerCase() === "macos");
  const macTotal = macNodes.length;
  const macOnline = macNodes.filter(n => n.status === "online").length;
  const macOffline = macTotal - macOnline;
  
  let macCpuSum = 0;
  let macRamPctSum = 0;
  let macDiskPctSum = 0;
  let macOnlineWithMetrics = 0;
  let macLastHb: string | undefined = undefined;
  
  macNodes.forEach(n => {
    if (n.last_heartbeat) {
      if (!macLastHb || new Date(n.last_heartbeat) > new Date(macLastHb)) {
        macLastHb = n.last_heartbeat;
      }
    }
    if (n.status === "online") {
      macOnlineWithMetrics++;
      macCpuSum += n.cpu_usage || 0;
      const totalRam = n.total_memory || 0;
      const ramPct = totalRam > 0 ? ((n.memory_used || 0) / totalRam) * 100 : 0;
      macRamPctSum += ramPct;
      
      // Calculate disk pct
      const details = n.detailed_metrics as any;
      if (details && details.disk_partitions && details.disk_partitions.length > 0) {
        macDiskPctSum += details.disk_partitions[0].percent || 0;
      } else {
        const totalDisk = (n.disk_used || 0) + (n.disk_free || 0);
        macDiskPctSum += totalDisk > 0 ? (n.disk_used! / totalDisk) * 100 : 0;
      }
    }
  });
  
  const macCpuAvg = macOnlineWithMetrics > 0 ? Math.round(macCpuSum / macOnlineWithMetrics) : 0;
  const macRamAvg = macOnlineWithMetrics > 0 ? Math.round(macRamPctSum / macOnlineWithMetrics) : 0;
  const macDiskAvg = macOnlineWithMetrics > 0 ? Math.round(macDiskPctSum / macOnlineWithMetrics) : 0;

  const linuxNodes = nodeArray.filter(n => n.os?.toLowerCase() === "linux");
  const linuxTotal = linuxNodes.length;
  const linuxOnline = linuxNodes.filter(n => n.status === "online").length;
  const linuxOffline = linuxTotal - linuxOnline;
  
  let linuxCpuSum = 0;
  let linuxRamPctSum = 0;
  let linuxDiskPctSum = 0;
  let linuxOnlineWithMetrics = 0;
  let linuxLastHb: string | undefined = undefined;
  
  linuxNodes.forEach(n => {
    if (n.last_heartbeat) {
      if (!linuxLastHb || new Date(n.last_heartbeat) > new Date(linuxLastHb)) {
        linuxLastHb = n.last_heartbeat;
      }
    }
    if (n.status === "online") {
      linuxOnlineWithMetrics++;
      linuxCpuSum += n.cpu_usage || 0;
      const totalRam = n.total_memory || 0;
      const ramPct = totalRam > 0 ? ((n.memory_used || 0) / totalRam) * 100 : 0;
      linuxRamPctSum += ramPct;
      
      // Calculate disk pct
      const details = n.detailed_metrics as any;
      if (details && details.disk_partitions && details.disk_partitions.length > 0) {
        linuxDiskPctSum += details.disk_partitions[0].percent || 0;
      } else {
        const totalDisk = (n.disk_used || 0) + (n.disk_free || 0);
        linuxDiskPctSum += totalDisk > 0 ? (n.disk_used! / totalDisk) * 100 : 0;
      }
    }
  });
  
  const linuxCpuAvg = linuxOnlineWithMetrics > 0 ? Math.round(linuxCpuSum / linuxOnlineWithMetrics) : 0;
  const linuxRamAvg = linuxOnlineWithMetrics > 0 ? Math.round(linuxRamPctSum / linuxOnlineWithMetrics) : 0;
  const linuxDiskAvg = linuxOnlineWithMetrics > 0 ? Math.round(linuxDiskPctSum / linuxOnlineWithMetrics) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground cyber-grid pb-12">
      
      {/* Top Banner Alert if WS is closed */}
      {!wsConnected && (
        <div className="bg-destructive/15 border-b border-destructive/30 py-2.5 px-4 text-center flex items-center justify-center gap-2 text-sm text-destructive font-medium animate-pulse">
          <AlertTriangle className="h-4 w-4" />
          Disconnected from Cluster Broker. Auto-reconnecting...
        </div>
      )}

      {/* Header Bar */}
      <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-primary to-purple-600 flex items-center justify-center shadow-lg shadow-primary/20">
              <Network className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                ClusterDash
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary/20 border border-primary/30 text-primary-foreground tracking-wider">
                  v1.0 (Swarm)
                </span>
              </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border text-xs">
              <div className={`h-2.5 w-2.5 rounded-full ${wsConnected ? "bg-success animate-pulse" : "bg-destructive animate-ping-slow"}`} />
              <span className="text-gray-400">Broker:</span>
              <span className="font-semibold text-white">{wsConnected ? "Connected" : "Re-connecting"}</span>
            </div>
            
            <button 
              onClick={triggerStatsRefresh}
              className="p-2 rounded-lg bg-secondary hover:bg-accent border border-border text-gray-400 hover:text-white transition-colors"
              title="Force Sync Stats"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* LEFT COLUMN: Overview Cards & Swarm Topology Map (takes 3 cols) */}
        <div className="lg:col-span-3 space-y-8">
          
          {/* Dashboard Aggregate Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            {/* Cluster Status */}
            <div className="bg-card/40 border border-border rounded-xl p-5 glow-card">
              <div className="flex justify-between items-start text-gray-400">
                <span className="text-sm font-medium">Cluster State</span>
                <Shield className={`h-5 w-5 ${
                  clusterStats.status === "healthy" ? "text-success" : 
                  clusterStats.status === "warning" ? "text-warning" : "text-destructive"
                }`} />
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold tracking-tight text-white capitalize">
                  {clusterStats.status}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Active Swarm topology validation
                </p>
              </div>
            </div>

            {/* Nodes Ratio */}
            <div className="bg-card/40 border border-border rounded-xl p-5 glow-card">
              <div className="flex justify-between items-start text-gray-400">
                <span className="text-sm font-medium">Online Nodes</span>
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold tracking-tight text-white">
                  {clusterStats.online_nodes} <span className="text-sm font-normal text-gray-500">/ {clusterStats.total_nodes}</span>
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {clusterStats.offline_nodes} offline machines
                </p>
              </div>
            </div>

            {/* Total Cores */}
            <div className="bg-card/40 border border-border rounded-xl p-5 glow-card">
              <div className="flex justify-between items-start text-gray-400">
                <span className="text-sm font-medium">Cluster CPU Cores</span>
                <Cpu className="h-5 w-5 text-purple-400" />
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold tracking-tight text-white">
                  {clusterStats.total_cpu_cores}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Distributed across physical swarm
                </p>
              </div>
            </div>

            {/* Total Memory */}
            <div className="bg-card/40 border border-border rounded-xl p-5 glow-card">
              <div className="flex justify-between items-start text-gray-400">
                <span className="text-sm font-medium">Total Swarm RAM</span>
                <Database className="h-5 w-5 text-blue-400" />
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold tracking-tight text-white">
                  {formatBytes(clusterStats.total_memory)}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Shared memory allocation
                </p>
              </div>
            </div>

          </div>

          {/* OS Grouped Cluster Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Windows Card */}
            <Link href="/cluster?os=windows" className="block group">
              <div className="bg-card/40 border border-border hover:border-blue-500/50 rounded-2xl p-6 glow-card transition-all duration-300 relative overflow-hidden h-full">
                <div className="absolute top-0 right-0 h-32 w-32 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all duration-500" />
                
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2 group-hover:text-blue-400 transition-colors">
                      <svg className="h-5 w-5 text-blue-500 group-hover:animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M0 3.449L9.75 2.1v9.45H0V3.449zM0 12.45h9.75v9.45L0 20.551v-8.1zM10.8 1.95L24 0v11.55H10.8V1.95zM10.8 12.45H24v11.55l-13.2-1.95v-9.6z"/>
                      </svg>
                      Windows Cluster
                    </h3>
                    <p className="text-xs text-gray-500 font-medium">Enterprise Windows Infrastructure</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-400">
                    Windows
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border/40 text-center">
                  <div>
                    <div className="text-2xl font-bold text-white">{winTotal}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Nodes</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-success">{winOnline}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Online</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-destructive">{winOffline}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Offline</div>
                  </div>
                </div>

                {/* Live Gauges */}
                <div className="space-y-3 mt-6">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>CPU Average</span>
                      <span className="text-white font-semibold">{winCpuAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-blue-500 h-full transition-all duration-1000" 
                        style={{ width: `${winCpuAvg}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>RAM Average</span>
                      <span className="text-white font-semibold">{winRamAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-purple-500 h-full transition-all duration-1000" 
                        style={{ width: `${winRamAvg}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Disk Usage</span>
                      <span className="text-white font-semibold">{winDiskAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-orange-500 h-full transition-all duration-1000" 
                        style={{ width: `${winDiskAvg}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border/40 flex justify-between items-center text-xs text-gray-500">
                  <span>Last Heartbeat:</span>
                  <span className="font-mono text-white flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    {winLastHb ? new Date(winLastHb).toLocaleTimeString() : "N/A"}
                  </span>
                </div>
              </div>
            </Link>

            {/* Mac Card */}
            <Link href="/cluster?os=mac" className="block group">
              <div className="bg-card/40 border border-border hover:border-purple-500/50 rounded-2xl p-6 glow-card transition-all duration-300 relative overflow-hidden h-full">
                <div className="absolute top-0 right-0 h-32 w-32 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-all duration-500" />
                
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2 group-hover:text-purple-400 transition-colors">
                      <svg className="h-5 w-5 text-purple-500 group-hover:animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.22.67-2.94 1.51-.62.71-1.16 1.85-1.02 2.96 1.12.09 2.27-.58 2.97-1.41z"/>
                      </svg>
                      Mac Cluster
                    </h3>
                    <p className="text-xs text-gray-500 font-medium">Enterprise macOS Infrastructure</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-400">
                    Mac
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border/40 text-center">
                  <div>
                    <div className="text-2xl font-bold text-white">{macTotal}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Nodes</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-success">{macOnline}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Online</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-destructive">{macOffline}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Offline</div>
                  </div>
                </div>

                {/* Live Gauges */}
                <div className="space-y-3 mt-6">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>CPU Average</span>
                      <span className="text-white font-semibold">{macCpuAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-purple-500 h-full transition-all duration-1000" 
                        style={{ width: `${macCpuAvg}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>RAM Average</span>
                      <span className="text-white font-semibold">{macRamAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-pink-500 h-full transition-all duration-1000" 
                        style={{ width: `${macRamAvg}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Disk Usage</span>
                      <span className="text-white font-semibold">{macDiskAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-orange-500 h-full transition-all duration-1000" 
                        style={{ width: `${macDiskAvg}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border/40 flex justify-between items-center text-xs text-gray-500">
                  <span>Last Heartbeat:</span>
                  <span className="font-mono text-white flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    {macLastHb ? new Date(macLastHb).toLocaleTimeString() : "N/A"}
                  </span>
                </div>
              </div>
            </Link>

            {/* Linux Card */}
            <Link href="/cluster?os=linux" className="block group">
              <div className="bg-card/40 border border-border hover:border-success/50 rounded-2xl p-6 glow-card transition-all duration-300 relative overflow-hidden h-full">
                <div className="absolute top-0 right-0 h-32 w-32 bg-success/5 rounded-full blur-2xl group-hover:bg-success/10 transition-all duration-500" />
                
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2 group-hover:text-success transition-colors">
                      <svg className="h-5 w-5 text-success group-hover:animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 2a8 8 0 0 1 8 8c0 1.22-.27 2.37-.75 3.4L15.35 12.3c.4-.6.65-1.32.65-2.1c0-2.2-1.8-4-4-4s-4 1.8-4 4c0 .78.25 1.5.65 2.1l-3.9 5.1A7.95 7.95 0 0 1 4 12a8 8 0 0 1 8-8m0 4a2 2 0 0 0-2 2c0 .64.3 1.2.78 1.57L9.2 16.5c-.7-.34-1.2-.95-1.2-1.7 0-1.1.9-2 2-2s2 .9 2 2c0 .75-.5 1.36-1.2 1.7l1.58 2.93c.48-.37.78-.93.78-1.57a2 2 0 0 0-2-2m-1.58 6.93L12 15.6l1.58 2.93c-.48.37-.78.93-.78 1.57a2 2 0 0 1-2-2z"/>
                      </svg>
                      Linux Cluster
                    </h3>
                    <p className="text-xs text-gray-500 font-medium">Enterprise Linux Infrastructure</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-success/25 border border-success/30 text-success">
                    Linux
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border/40 text-center">
                  <div>
                    <div className="text-2xl font-bold text-white">{linuxTotal}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Nodes</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-success">{linuxOnline}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Online</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-destructive">{linuxOffline}</div>
                    <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Offline</div>
                  </div>
                </div>

                {/* Live Gauges */}
                <div className="space-y-3 mt-6">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>CPU Average</span>
                      <span className="text-white font-semibold">{linuxCpuAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-success h-full transition-all duration-1000" 
                        style={{ width: `${linuxCpuAvg}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>RAM Average</span>
                      <span className="text-white font-semibold">{linuxRamAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-purple-500 h-full transition-all duration-1000" 
                        style={{ width: `${linuxRamAvg}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Disk Usage</span>
                      <span className="text-white font-semibold">{linuxDiskAvg}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-orange-500 h-full transition-all duration-1000" 
                        style={{ width: `${linuxDiskAvg}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border/40 flex justify-between items-center text-xs text-gray-500">
                  <span>Last Heartbeat:</span>
                  <span className="font-mono text-white flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    {linuxLastHb ? new Date(linuxLastHb).toLocaleTimeString() : "N/A"}
                  </span>
                </div>
              </div>
            </Link>
          </div>

        </div>

        {/* RIGHT COLUMN: Active Alerts log (takes 1 col) */}
        <div className="lg:col-span-1 space-y-6">
          
          <div className="bg-card/40 border border-border rounded-xl p-5 sticky top-24">
            
            <div className="flex items-center justify-between border-b border-border/60 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-warning" />
                <h2 className="text-base font-bold text-white">Active Swarm Alerts</h2>
              </div>
              <span className="text-[10px] font-bold bg-secondary text-gray-300 px-2 py-0.5 rounded-full">
                {alerts.filter(a => !a.resolved).length}
              </span>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {alerts.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircle className="h-8 w-8 text-success mx-auto mb-2" />
                  <p className="text-xs font-semibold">Cluster Healthy</p>
                  <p className="text-[10px] text-gray-600 mt-1">Zero unresolved exceptions</p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <div 
                    key={alert.id} 
                    className={`p-3 rounded-lg border text-xs relative overflow-hidden transition-all ${
                      alert.resolved 
                        ? "bg-secondary/20 border-border text-gray-500 opacity-60" 
                        : alert.severity === "critical"
                          ? "bg-destructive/10 border-destructive/30 text-red-300"
                          : "bg-warning/10 border-warning/30 text-amber-200"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <span className="font-bold uppercase tracking-wider text-[9px] flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          alert.resolved ? "bg-gray-500" : alert.severity === "critical" ? "bg-destructive" : "bg-warning"
                        }`} />
                        {alert.type}
                      </span>
                      <span className="text-[9px] text-gray-500 flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <p className="font-medium text-white leading-snug">{alert.message}</p>
                    <div className="mt-2 flex justify-between items-center text-[10px]">
                      <span className="text-gray-400">Node: <strong className="text-gray-300">{alert.node_hostname || alert.node_id}</strong></span>
                      {alert.resolved ? (
                        <span className="text-success font-semibold flex items-center gap-0.5">
                          <CheckCircle className="h-3 w-3" /> Resolved
                        </span>
                      ) : (
                        <span className="text-destructive font-semibold">Active Alarm</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t border-border text-center">
              <span className="text-[10px] text-gray-500 font-mono">
                System threshold alerts trigger on CPU &gt; {settings.ALERT_CPU_THRESHOLD_PCT}%, Memory &gt; {settings.ALERT_MEM_THRESHOLD_PCT}%
              </span>
            </div>
            
          </div>
          
        </div>

      </main>

      {/* CONTINUOUS CONTAINER MATRIX SECTION */}
      <section className="max-w-7xl mx-auto px-6 mt-8">
        <div className="bg-card/40 border border-border rounded-xl p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-success" />
              <h2 className="text-lg font-semibold text-white">Running Containers Matrix</h2>
            </div>
            
            <div className="flex items-center gap-3">
              <input 
                type="text" 
                placeholder="Search container, image, or host..."
                value={searchContainer}
                onChange={(e) => setSearchContainer(e.target.value)}
                className="bg-secondary border border-border rounded-lg text-xs px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-primary w-60"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-gray-400 font-medium pb-2 uppercase tracking-wider text-[10px]">
                  <th className="pb-3 pl-3">Name</th>
                  <th className="pb-3">Container ID</th>
                  <th className="pb-3">Image</th>
                  <th className="pb-3">Placement Node</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">CPU Usage</th>
                  <th className="pb-3">RAM Allocation</th>
                  <th className="pb-3">Ports</th>
                  <th className="pb-3 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredContainers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      No matching container services running in Swarm.
                    </td>
                  </tr>
                ) : (
                  filteredContainers.map((container) => {
                    const isRunning = container.status === "running";
                    return (
                      <tr key={container.container_id} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="py-3.5 pl-3 font-semibold text-white flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${isRunning ? "bg-success" : "bg-destructive"}`} />
                          {container.name}
                        </td>
                        <td className="py-3.5 font-mono text-gray-500">{container.container_id}</td>
                        <td className="py-3.5 text-gray-400 truncate max-w-[150px]" title={container.image}>{container.image}</td>
                        <td className="py-3.5">
                          <span className="text-gray-300 font-medium">{container.nodeHostname}</span>
                        </td>
                        <td className="py-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isRunning ? "bg-success/10 text-success border border-success/20" : "bg-destructive/10 text-destructive border border-destructive/20"
                          }`}>
                            {container.status}
                          </span>
                        </td>
                        <td className="py-3.5 font-mono text-white">{isRunning ? `${container.cpu_usage}%` : "0%"}</td>
                        <td className="py-3.5 font-mono text-white">{isRunning ? formatBytes(container.memory_usage) : "0 Bytes"}</td>
                        <td className="py-3.5 text-gray-500 font-mono truncate max-w-[120px]" title={container.ports}>{container.ports || "-"}</td>
                        <td className="py-3.5 pr-3 text-right">
                          <button 
                            onClick={() => openContainerLogs(container.container_id, container.name)}
                            className="inline-flex items-center gap-1 text-primary hover:text-white bg-primary/10 hover:bg-primary border border-primary/20 rounded px-2.5 py-1 transition-all"
                          >
                            <Terminal className="h-3.5 w-3.5" />
                            Logs
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CONTAINER MOCK TERMINAL DRAWER */}
      {selectedContainer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-2xl bg-[#07070a] border-l border-border h-full flex flex-col shadow-2xl relative">
            
            {/* Header */}
            <div className="p-4 border-b border-border bg-[#0d0d12] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-primary animate-pulse" />
                <div>
                  <h3 className="font-bold text-white">{selectedContainer.name}</h3>
                  <span className="text-xs text-gray-500 font-mono">ID: {selectedContainer.id}</span>
                </div>
              </div>
              
              <button 
                onClick={() => setSelectedContainer(null)}
                className="p-1 rounded-lg hover:bg-secondary text-gray-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Terminal Console Output */}
            <div className="flex-1 p-5 overflow-y-auto bg-black font-mono text-xs text-green-400 space-y-2 select-text">
              <p className="text-gray-600"># docker logs --tail 100 {selectedContainer.name}</p>
              {selectedContainer.logs.map((log, index) => (
                <div key={index} className="flex gap-2 hover:bg-white/[0.03] py-0.5 rounded px-1">
                  <span className="text-gray-700 select-none">[{index + 1}]</span>
                  <span className="whitespace-pre-wrap">{log}</span>
                </div>
              ))}
              <div className="h-1 animate-pulse bg-green-500/20 w-3 rounded-full mt-2" />
            </div>

            {/* Terminal Actions Footer */}
            <div className="p-4 border-t border-border bg-[#0d0d12] flex items-center justify-between text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                Streaming stdout/stderr (Mocked)
              </span>
              
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    const newLog = `[${new Date().toISOString()}] Manual debug checkpoint requested. Health checks: OK.`;
                    setSelectedContainer(prev => prev ? { ...prev, logs: [...prev.logs, newLog] } : null);
                  }}
                  className="bg-secondary hover:bg-accent border border-border px-3 py-1.5 rounded text-white font-medium transition-colors"
                >
                  Generate Log Event
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

// Fallback configuration settings mirroring core backend defaults for static UI formatting
const settings = {
  ALERT_CPU_THRESHOLD_PCT: 85,
  ALERT_MEM_THRESHOLD_PCT: 90,
  NODE_OFFLINE_TIMEOUT_SECONDS: 15,
};
