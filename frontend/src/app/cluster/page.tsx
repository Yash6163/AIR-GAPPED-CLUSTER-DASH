"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { 
  Server, Shield, RefreshCw, Cpu, Database, Network, 
  Terminal, Activity, ArrowLeft, Heart, Play, AlertTriangle, CheckCircle, Clock
} from "lucide-react";

interface ContainerMetric {
  container_id: string;
  name: string;
  image: string;
  status: string;
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
  
  cpu_usage?: number;
  memory_used?: number;
  memory_free?: number;
  disk_used?: number;
  disk_free?: number;
  net_send?: number;
  net_recv?: number;
  containers?: ContainerMetric[];
  detailed_metrics?: any;
}

function ClusterDetailContent() {
  const searchParams = useSearchParams();
  const osTarget = (searchParams.get("os") || "windows").toLowerCase();
  const osLabel = osTarget === "darwin" || osTarget === "mac" || osTarget === "macos"
    ? "macOS" 
    : osTarget === "linux"
      ? "Linux"
      : "Windows";

  const [nodes, setNodes] = useState<Record<string, Node>>({});
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [apiUrls, setApiUrls] = useState<{ rest: string; ws: string } | null>(null);

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

  const bootstrapData = async () => {
    if (!apiUrls) return;
    try {
      const res = await fetch(`${apiUrls.rest}/nodes`);
      const nodesData: Node[] = await res.json();
      
      const nodeRecords: Record<string, Node> = {};
      nodesData.forEach(n => {
        const nodeOs = n.os?.toLowerCase();
        const matchesOs = osTarget === "mac" 
          ? (nodeOs === "darwin" || nodeOs === "mac" || nodeOs === "macos") 
          : osTarget === "linux"
            ? (nodeOs === "linux")
            : (nodeOs === "windows");

        if (matchesOs) {
          nodeRecords[n.id] = {
            ...n,
            cpu_usage: n.cpu_usage || 0,
            memory_used: n.memory_used || 0,
            memory_free: n.memory_free || n.total_memory,
            disk_used: n.disk_used || 0,
            disk_free: n.disk_free || 0
          };
        }
      });
      setNodes(nodeRecords);
    } catch (err) {
      console.error("Failed to bootstrap cluster detail data:", err);
    }
  };

  useEffect(() => {
    if (!apiUrls) return;
    bootstrapData();
  }, [apiUrls, osTarget]);

  useEffect(() => {
    if (!apiUrls) return;

    const connectWS = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      console.log(`Connecting to WebSocket for ${osLabel} cluster...`);
      const ws = new WebSocket(apiUrls.ws);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { event: eventName, data } = msg;

          if (eventName === "metrics_update") {
            setNodes((prev) => {
              if (!prev[data.node_id]) return prev;
              const node = prev[data.node_id];
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
                  uptime: data.uptime,
                  last_heartbeat: data.last_heartbeat,
                  detailed_metrics: data.detailed_metrics,
                  status: "online"
                }
              };
            });
          }

          else if (eventName === "heartbeat") {
            setNodes((prev) => {
              if (!prev[data.node_id]) return prev;
              const node = prev[data.node_id];
              return {
                ...prev,
                [data.node_id]: {
                  ...node,
                  latency: data.latency,
                  last_heartbeat: data.timestamp,
                  status: "online"
                }
              };
            });
          }

          else if (eventName === "node_status_change") {
            setNodes((prev) => {
              if (!prev[data.node_id]) return prev;
              const node = prev[data.node_id];
              return {
                ...prev,
                [data.node_id]: {
                  ...node,
                  status: data.status,
                  last_heartbeat: data.timestamp
                }
              };
            });
          }
        } catch (e) {
          console.error("Error processing websocket payload:", e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connectWS, 4000);
      };

      ws.onerror = (err) => {
        console.error("WebSocket client encountered error:", err);
        ws.close();
      };
    };

    connectWS();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [apiUrls, osLabel]);

  const nodeArray = Object.values(nodes);
  const managerNode = nodeArray.find(n => n.role === "manager") || nodeArray[0];
  const workerNodes = nodeArray.filter(n => n.id !== managerNode?.id);

  const formatBytes = (bytes: number, decimals = 1) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="min-h-screen bg-background text-foreground cyber-grid pb-12">
      
      {!wsConnected && (
        <div className="bg-destructive/15 border-b border-destructive/30 py-2.5 px-4 text-center flex items-center justify-center gap-2 text-sm text-destructive font-medium animate-pulse">
          <AlertTriangle className="h-4 w-4" />
          Disconnected from Broker. Re-connecting...
        </div>
      )}

      <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white transition-colors bg-secondary border border-border px-3 py-1.5 rounded-lg font-sans">
              <ArrowLeft className="h-3.5 w-3.5" />
              Overview
            </Link>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                {osLabel} Cluster Node Map
              </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-border text-xs">
              <div className={`h-2.5 w-2.5 rounded-full ${wsConnected ? "bg-success animate-pulse" : "bg-destructive"}`} />
              <span className="text-gray-400">Stream:</span>
              <span className="font-semibold text-white">{wsConnected ? "Active" : "Offline"}</span>
            </div>
            <button 
              onClick={bootstrapData}
              className="p-2 rounded-lg bg-secondary hover:bg-accent border border-border text-gray-400 hover:text-white transition-colors"
              title="Refresh Nodes"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-8">
        
        {nodeArray.length === 0 ? (
          <div className="bg-card/30 border border-border rounded-xl p-12 text-center max-w-lg mx-auto mt-20">
            <Server className="h-12 w-12 text-gray-600 mx-auto mb-4 animate-bounce" />
            <h3 className="text-lg font-bold text-white">No Cluster Nodes Registered</h3>
            <p className="text-sm text-gray-500 mt-2 font-sans">
              Start a worker daemon on your {osLabel} machine with the registration token to register it.
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            
            <div className="bg-card/20 border border-border rounded-2xl p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 h-40 w-40 bg-primary/5 rounded-full blur-3xl -z-10" />
              
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">Swarm Network Topology</h3>
                  <p className="text-xs text-gray-500 mt-0.5 font-sans">Physical and container placements mapping</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-secondary/40 border border-border/60 rounded px-2.5 py-1">
                  <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  Live update routing
                </div>
              </div>

              <div className="border border-border/40 bg-black/40 rounded-xl p-6 relative min-h-[450px] flex flex-col items-center justify-between">
                
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="svg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity="0.8" />
                    </linearGradient>
                  </defs>

                  {managerNode && workerNodes.map((worker, index) => {
                    const wCount = workerNodes.length;
                    const wPct = wCount === 1 ? 50 : ((index) / (wCount - 1)) * 80 + 10;
                    
                    return (
                      <g key={worker.id}>
                        <path 
                          d={`M 50% 120 C 50% 200, ${wPct}% 200, ${wPct}% 310`}
                          fill="none" 
                          stroke={worker.status === "online" ? "url(#svg-grad)" : "hsl(var(--destructive) / 0.25)"} 
                          strokeWidth="2.5"
                          strokeDasharray={worker.status === "online" ? "none" : "6,6"}
                          className="transition-all duration-1000"
                        />
                        
                        {worker.status === "online" && (
                          <circle r="4" fill="hsl(var(--success))">
                            <animateMotion 
                              path={`M 50% 120 C 50% 200, ${wPct}% 200, ${wPct}% 310`} 
                              dur="2.5s" 
                              repeatCount="indefinite" 
                            />
                            <animate attributeName="opacity" values="0.1;1;0.1" dur="1.5s" repeatCount="indefinite" />
                          </circle>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {managerNode && (
                  <div className="z-10 mb-20">
                    <NodeCard node={managerNode} isManager={true} formatBytes={formatBytes} />
                  </div>
                )}

                <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 z-10">
                  {workerNodes.map((worker) => (
                    <NodeCard key={worker.id} node={worker} isManager={false} formatBytes={formatBytes} />
                  ))}
                </div>

              </div>

            </div>

          </div>
        )}

      </main>

    </div>
  );
}

function NodeCard({ node, isManager, formatBytes }: { node: Node; isManager: boolean; formatBytes: any }) {
  const isOnline = node.status === "online";
  
  let diskPercent = 0;
  if (node.detailed_metrics && node.detailed_metrics.disk_partitions && node.detailed_metrics.disk_partitions.length > 0) {
    diskPercent = Math.round(node.detailed_metrics.disk_partitions[0].percent || 0);
  } else {
    const totalDisk = (node.disk_used || 0) + (node.disk_free || 0);
    diskPercent = totalDisk > 0 ? Math.round((node.disk_used! / totalDisk) * 100) : 0;
  }

  const totalRamGb = node.total_memory / (1024 * 1024 * 1024);
  const ramPercent = totalRamGb > 0 ? ((node.memory_used || 0) / node.total_memory) * 100 : 0;

  return (
    <Link href={`/nodes?id=${node.id}`} className="block">
      <div className={`bg-card border rounded-2xl p-5 glow-card transition-all duration-300 w-full hover:scale-[1.02] ${
        isManager ? "border-primary/80 ring-2 ring-primary/20 max-w-sm mx-auto" : "border-border"
      }`}>
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${
              isOnline ? "bg-success/10 text-success animate-pulse" : "bg-destructive/10 text-destructive"
            }`}>
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h4 className="font-bold text-white text-sm tracking-tight leading-none group-hover:text-primary">
                  {node.hostname}
                </h4>
                <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded leading-none ${
                  isManager ? "bg-primary/20 text-primary border border-primary/30" : "bg-secondary text-gray-400"
                }`}>
                  {isManager ? "Manager" : "Worker"}
                </span>
              </div>
              <span className="text-[10px] text-gray-500 font-mono mt-1 block">{node.ip_address}</span>
            </div>
          </div>

          <div className="text-right">
            <div className="flex items-center gap-1.5 justify-end">
              <div className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-success" : "bg-destructive"}`} />
              <span className={`text-xs font-bold ${isOnline ? "text-success" : "text-destructive"}`}>
                {node.status}
              </span>
            </div>
            <span className="text-[9px] text-gray-500 font-mono block mt-1">
              {isOnline ? `${node.latency}ms latency` : "OFFLINE"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-border/40 text-[10px] text-gray-400">
          <div>
            Container ID: <strong className="text-white font-mono">{node.container_id ? node.container_id.substring(0, 10) : "N/A"}</strong>
          </div>
          <div>
            OS: <strong className="text-white capitalize">{node.os || "Unknown"}</strong>
          </div>
        </div>

        {isOnline ? (
          <div className="space-y-2.5 mt-4 pt-3 border-t border-border/40">
            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span>CPU Usage</span>
                <span className="text-white font-semibold">{node.cpu_usage || 0}%</span>
              </div>
              <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-500 h-full transition-all duration-1000" 
                  style={{ width: `${node.cpu_usage || 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span>RAM Allocation</span>
                <span className="text-white font-semibold">{ramPercent.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-purple-500 h-full transition-all duration-1000" 
                  style={{ width: `${ramPercent}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span>Disk Usage</span>
                <span className="text-white font-semibold">{diskPercent}%</span>
              </div>
              <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-orange-500 h-full transition-all duration-1000" 
                  style={{ width: `${diskPercent}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-gray-500 flex flex-col items-center justify-center">
            <Activity className="h-6 w-6 text-gray-600 mb-1" />
            <span className="text-xs font-semibold">Node Offline</span>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border/40 flex justify-between items-center text-[10px] text-gray-500">
          <span>Heartbeat:</span>
          <span className="font-mono text-white">
            {node.last_heartbeat ? new Date(node.last_heartbeat).toLocaleTimeString() : "N/A"}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function ClusterDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-foreground flex items-center justify-center">Loading cluster details...</div>}>
      <ClusterDetailContent />
    </Suspense>
  );
}
