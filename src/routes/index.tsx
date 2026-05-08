import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { EquipmentMap, type MapMarker } from "@/components/equipment-map";
import { toast } from "sonner";
import { HardHat, Plus, KeyRound, MapPin, History, LogOut, Wrench, CheckCircle2, Truck, ArrowRightLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { User } from "@supabase/supabase-js";

export const Route = createFileRoute("/")({ component: Dashboard });

type Equipment = {
  id: string; name: string; type: string; identifier: string;
  status: "available" | "checked_out" | "maintenance";
  latitude: number; longitude: number; site_id: string | null;
};
type Site = { id: string; name: string; address: string | null; latitude: number; longitude: number };
type Checkout = { id: string; equipment_id: string; user_id: string; checked_out_at: string; returned_at: string | null; notes: string | null };
type AuditEntry = { id: string; user_id: string | null; equipment_id: string | null; action: string; details: any; created_at: string };
type Profile = { id: string; full_name: string | null };

function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [siteForm, setSiteForm] = useState({ name: "", address: "", latitude: "", longitude: "" });
  const [pickMode, setPickMode] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null); setAuthReady(true);
      if (!s) navigate({ to: "/login" });
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
      if (!data.session) navigate({ to: "/login" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const qc = useQueryClient();
  const enabled = !!user;

  const equipmentQ = useQuery({
    queryKey: ["equipment"], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("equipment").select("*").order("name");
      if (error) throw error; return data as Equipment[];
    },
  });
  const sitesQ = useQuery({
    queryKey: ["sites"], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").order("name");
      if (error) throw error; return data as Site[];
    },
  });
  const checkoutsQ = useQuery({
    queryKey: ["checkouts"], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("checkouts").select("*").order("checked_out_at", { ascending: false });
      if (error) throw error; return data as Checkout[];
    },
  });
  const auditQ = useQuery({
    queryKey: ["audit"], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error; return data as AuditEntry[];
    },
  });
  const profilesQ = useQuery({
    queryKey: ["profiles"], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error; return data as Profile[];
    },
  });

  const profileMap = useMemo(() => Object.fromEntries((profilesQ.data ?? []).map(p => [p.id, p.full_name ?? "Unknown"])), [profilesQ.data]);
  const equipmentMap = useMemo(() => Object.fromEntries((equipmentQ.data ?? []).map(e => [e.id, e])), [equipmentQ.data]);
  const siteMap = useMemo(() => Object.fromEntries((sitesQ.data ?? []).map(s => [s.id, s])), [sitesQ.data]);

  const markers: MapMarker[] = useMemo(() =>
    (equipmentQ.data ?? []).map(e => ({
      id: e.id, lat: e.latitude, lng: e.longitude, label: e.name,
      sublabel: `${e.type} • ${e.identifier}`, status: e.status,
    })), [equipmentQ.data]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["equipment"] });
    qc.invalidateQueries({ queryKey: ["checkouts"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
  };

  const checkoutMut = useMutation({
    mutationFn: async (eq: Equipment) => {
      if (!user) throw new Error("Not signed in");
      const { error: cErr } = await supabase.from("checkouts").insert({ equipment_id: eq.id, user_id: user.id });
      if (cErr) throw cErr;
      const { error: uErr } = await supabase.from("equipment").update({ status: "checked_out", updated_at: new Date().toISOString() }).eq("id", eq.id);
      if (uErr) throw uErr;
      await supabase.from("audit_log").insert({
        user_id: user.id, equipment_id: eq.id, action: "key_checked_out",
        details: { equipment_name: eq.name, identifier: eq.identifier },
      });
    },
    onSuccess: () => { toast.success("Keys checked out"); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  const returnMut = useMutation({
    mutationFn: async (eq: Equipment) => {
      if (!user) throw new Error("Not signed in");
      const { data: open } = await supabase.from("checkouts").select("*").eq("equipment_id", eq.id).is("returned_at", null).order("checked_out_at", { ascending: false }).limit(1).maybeSingle();
      if (open) {
        await supabase.from("checkouts").update({ returned_at: new Date().toISOString() }).eq("id", open.id);
      }
      await supabase.from("equipment").update({ status: "available", updated_at: new Date().toISOString() }).eq("id", eq.id);
      await supabase.from("audit_log").insert({
        user_id: user.id, equipment_id: eq.id, action: "key_returned",
        details: { equipment_name: eq.name, identifier: eq.identifier },
      });
    },
    onSuccess: () => { toast.success("Keys returned"); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: async ({ eq, siteId }: { eq: Equipment; siteId: string }) => {
      if (!user) throw new Error("Not signed in");
      const site = siteMap[siteId];
      if (!site) throw new Error("Site not found");
      await supabase.from("equipment").update({
        site_id: site.id, latitude: site.latitude, longitude: site.longitude,
        updated_at: new Date().toISOString(),
      }).eq("id", eq.id);
      await supabase.from("audit_log").insert({
        user_id: user.id, equipment_id: eq.id, action: "site_assigned",
        details: { equipment_name: eq.name, site_name: site.name },
      });
    },
    onSuccess: () => { toast.success("Site assigned"); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!authReady) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return null;

  const stats = {
    total: equipmentQ.data?.length ?? 0,
    available: equipmentQ.data?.filter(e => e.status === "available").length ?? 0,
    checked: equipmentQ.data?.filter(e => e.status === "checked_out").length ?? 0,
    maint: equipmentQ.data?.filter(e => e.status === "maintenance").length ?? 0,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-sidebar text-sidebar-foreground">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-secondary">
            <HardHat className="h-5 w-5" /> FleetSite
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:block text-sidebar-foreground/70">{profileMap[user.id] ?? user.email}</span>
            <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>
              <LogOut className="h-4 w-4 mr-1.5" />Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Truck className="h-4 w-4" />} label="Total fleet" value={stats.total} />
          <StatCard icon={<CheckCircle2 className="h-4 w-4 text-success" />} label="Available" value={stats.available} />
          <StatCard icon={<KeyRound className="h-4 w-4 text-warning" />} label="Checked out" value={stats.checked} />
          <StatCard icon={<Wrench className="h-4 w-4 text-destructive" />} label="Maintenance" value={stats.maint} />
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-4">
          <Card className="overflow-hidden h-[500px] p-0 relative">
            {pickMode && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[400] bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 pointer-events-auto">
                <MapPin className="h-3.5 w-3.5" /> Click map to set site location
                <button type="button" onClick={() => setPickMode(false)} className="ml-1 underline">Cancel</button>
              </div>
            )}
            <EquipmentMap
              markers={markers}
              onMarkerClick={setSelectedId}
              selectedId={selectedId}
              pickMode={pickMode}
              pickedPoint={siteForm.latitude && siteForm.longitude ? { lat: parseFloat(siteForm.latitude), lng: parseFloat(siteForm.longitude) } : null}
              onMapClick={(lat, lng) => {
                setSiteForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
                setPickMode(false);
                setSiteDialogOpen(true);
              }}
            />
          </Card>
          <Card className="p-4 h-[500px] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Live equipment</h3>
              <NewEquipmentDialog sites={sitesQ.data ?? []} userId={user.id} onCreated={refreshAll} />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {(equipmentQ.data ?? []).map(eq => (
                <button key={eq.id} onClick={() => setSelectedId(eq.id)}
                  className={`w-full text-left p-3 rounded-md border transition-colors ${selectedId === eq.id ? "border-primary bg-accent" : "hover:bg-muted"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{eq.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{eq.type} • {eq.identifier}</div>
                    </div>
                    <StatusBadge status={eq.status} />
                  </div>
                </button>
              ))}
              {!equipmentQ.data?.length && <p className="text-sm text-muted-foreground text-center py-8">No equipment yet. Add your first machine.</p>}
            </div>
          </Card>
        </div>

        <Tabs defaultValue="equipment">
          <TabsList>
            <TabsTrigger value="equipment"><Truck className="h-4 w-4 mr-1.5" />Equipment</TabsTrigger>
            <TabsTrigger value="sites"><MapPin className="h-4 w-4 mr-1.5" />Sites</TabsTrigger>
            <TabsTrigger value="audit"><History className="h-4 w-4 mr-1.5" />Audit log</TabsTrigger>
          </TabsList>

          <TabsContent value="equipment" className="mt-4">
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="text-left p-3 font-medium">Machine</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Identifier</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Site</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(equipmentQ.data ?? []).map(eq => {
                    const open = checkoutsQ.data?.find(c => c.equipment_id === eq.id && !c.returned_at);
                    return (
                      <tr key={eq.id} className="border-t">
                        <td className="p-3">
                          <div className="font-medium">{eq.name}</div>
                          <div className="text-xs text-muted-foreground">{eq.type}</div>
                        </td>
                        <td className="p-3 font-mono text-xs hidden md:table-cell">{eq.identifier}</td>
                        <td className="p-3 hidden md:table-cell">{eq.site_id ? siteMap[eq.site_id]?.name ?? "—" : <span className="text-muted-foreground">Unassigned</span>}</td>
                        <td className="p-3"><StatusBadge status={eq.status} /></td>
                        <td className="p-3 text-right space-x-1">
                          <AssignDialog eq={eq} sites={sitesQ.data ?? []} onAssign={(siteId) => assignMut.mutate({ eq, siteId })} />
                          {eq.status === "available" ? (
                            <Button size="sm" onClick={() => checkoutMut.mutate(eq)} disabled={checkoutMut.isPending}>
                              <KeyRound className="h-3.5 w-3.5 mr-1" />Check out
                            </Button>
                          ) : eq.status === "checked_out" ? (
                            <Button size="sm" variant="secondary" onClick={() => returnMut.mutate(eq)} disabled={returnMut.isPending}>
                              Return {open && profileMap[open.user_id] ? `(${profileMap[open.user_id]})` : ""}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!equipmentQ.data?.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No equipment yet.</td></tr>}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="sites" className="mt-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 className="font-semibold">Job sites</h3>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setPickMode(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <MapPin className="h-4 w-4 mr-1" />Pick on map
                  </Button>
                  <NewSiteDialog
                    open={siteDialogOpen}
                    onOpenChange={setSiteDialogOpen}
                    form={siteForm}
                    setForm={setSiteForm}
                    onPickOnMap={() => { setSiteDialogOpen(false); setPickMode(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    onCreated={() => qc.invalidateQueries({ queryKey: ["sites"] })}
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(sitesQ.data ?? []).map(s => {
                  const count = equipmentQ.data?.filter(e => e.site_id === s.id).length ?? 0;
                  return (
                    <Card key={s.id} className="p-3">
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-secondary mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{s.name}</div>
                          {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
                          <div className="text-xs mt-1"><Badge variant="outline">{count} machine{count === 1 ? "" : "s"}</Badge></div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
                {!sitesQ.data?.length && <p className="text-sm text-muted-foreground col-span-full text-center py-6">No sites yet. Add one to assign equipment.</p>}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-1.5"><History className="h-4 w-4" />Audit log</h3>
              <div className="space-y-1">
                {(auditQ.data ?? []).map(a => {
                  const eq = a.equipment_id ? equipmentMap[a.equipment_id] : null;
                  const who = a.user_id ? profileMap[a.user_id] ?? "Unknown" : "System";
                  const verb = a.action === "key_checked_out" ? "checked out keys to" :
                               a.action === "key_returned" ? "returned keys for" :
                               a.action === "site_assigned" ? "assigned" :
                               a.action === "equipment_created" ? "added" : a.action;
                  const target = (a.details as any)?.equipment_name ?? eq?.name ?? "";
                  const extra = a.action === "site_assigned" ? ` to ${(a.details as any)?.site_name ?? ""}` : "";
                  const Icon = a.action === "key_checked_out" ? KeyRound : a.action === "key_returned" ? CheckCircle2 : a.action === "site_assigned" ? ArrowRightLeft : Plus;
                  return (
                    <div key={a.id} className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
                      <div className="h-8 w-8 rounded-full bg-muted grid place-items-center shrink-0"><Icon className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{who}</span>{" "}
                        <span className="text-muted-foreground">{verb}</span>{" "}
                        <span className="font-medium">{target}</span>{extra}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                    </div>
                  );
                })}
                {!auditQ.data?.length && <p className="text-sm text-muted-foreground text-center py-6">No activity yet.</p>}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
}

function StatusBadge({ status }: { status: Equipment["status"] }) {
  const map = {
    available: { label: "Available", cls: "bg-success/15 text-success border-success/30" },
    checked_out: { label: "Checked out", cls: "bg-warning/15 text-warning-foreground border-warning/40" },
    maintenance: { label: "Maintenance", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  } as const;
  const m = map[status];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

function NewEquipmentDialog({ sites, userId, onCreated }: { sites: Site[]; userId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "Excavator", identifier: "", site_id: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const site = sites.find(s => s.id === form.site_id);
      const lat = site?.latitude ?? 39.5 + (Math.random() - 0.5) * 0.05;
      const lng = site?.longitude ?? -98.35 + (Math.random() - 0.5) * 0.05;
      const { data, error } = await supabase.from("equipment").insert({
        name: form.name, type: form.type, identifier: form.identifier,
        site_id: form.site_id || null, latitude: lat, longitude: lng,
      }).select().single();
      if (error) throw error;
      await supabase.from("audit_log").insert({
        user_id: userId, equipment_id: data.id, action: "equipment_created",
        details: { equipment_name: data.name, identifier: data.identifier },
      });
      toast.success("Equipment added");
      setOpen(false);
      setForm({ name: "", type: "Excavator", identifier: "", site_id: "" });
      onCreated();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Log new equipment</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="CAT 320 #1" /></div>
          <div><Label>Type</Label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Excavator","Bulldozer","Crane","Loader","Dump truck","Forklift","Compactor","Generator"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Identifier / VIN</Label><Input value={form.identifier} onChange={e => setForm({ ...form, identifier: e.target.value })} required placeholder="EX-001" /></div>
          <div><Label>Initial site (optional)</Label>
            <Select value={form.site_id} onValueChange={v => setForm({ ...form, site_id: v })}>
              <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
              <SelectContent>{sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter><Button type="submit" disabled={busy}>Add equipment</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SiteForm = { name: string; address: string; latitude: string; longitude: string };
function NewSiteDialog({ open, onOpenChange, form, setForm, onPickOnMap, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: SiteForm;
  setForm: React.Dispatch<React.SetStateAction<SiteForm>>;
  onPickOnMap: () => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const { error } = await supabase.from("sites").insert({
        name: form.name, address: form.address || null,
        latitude: parseFloat(form.latitude), longitude: parseFloat(form.longitude),
      });
      if (error) throw error;
      toast.success("Site added");
      onOpenChange(false); setForm({ name: "", address: "", latitude: "", longitude: "" });
      onCreated();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New site</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add job site</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Site name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="Downtown Tower" /></div>
          <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="123 Main St" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Latitude</Label><Input type="number" step="any" value={form.latitude} onChange={e => setForm({...form, latitude: e.target.value})} required placeholder="40.7128" /></div>
            <div><Label>Longitude</Label><Input type="number" step="any" value={form.longitude} onChange={e => setForm({...form, longitude: e.target.value})} required placeholder="-74.0060" /></div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onPickOnMap} className="w-full">
            <MapPin className="h-4 w-4 mr-1" />Pick location on map
          </Button>
          <DialogFooter><Button type="submit" disabled={busy || !form.latitude || !form.longitude}>Add site</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ eq, sites, onAssign }: { eq: Equipment; sites: Site[]; onAssign: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(eq.site_id ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><MapPin className="h-3.5 w-3.5 mr-1" />Assign</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign {eq.name} to a site</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
            <SelectContent>{sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          {!sites.length && <p className="text-sm text-muted-foreground">No sites yet — add one in the Sites tab.</p>}
        </div>
        <DialogFooter><Button onClick={() => { if (siteId) { onAssign(siteId); setOpen(false); } }} disabled={!siteId}>Assign</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
