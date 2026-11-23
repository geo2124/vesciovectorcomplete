import React, { useState, useMemo, useEffect } from "react";
import {
  useDB,
  DEFAULT_PHYSIO_PACKAGES,
  atomicBookPhysioAppointmentTransaction,
  type PhysioRecord,
  type PhysioTreatmentSession,
  type PhysioExercisePrescription,
  type PhysioAppointment,
  type PhysioAppointmentStatus,
  type PhysioPractitioner,
  type PhysioRoom,
  type PhysioPackageConfig,
  type PlayerMedicalClearanceStatus,
  type LedgerEntry,
} from "@/lib/data-store";
import { normalizeDoubleEntryLedger } from "@/lib/accounting-coa";
import { useAuth } from "@/lib/auth";
import {
  Button as Btn,
  Chip,
  Field,
  Input,
  Select,
  Modal,
  Textarea,
  money as kitMoney,
} from "@/components/kit";
import {
  HeartPulse,
  Users,
  UserCheck,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Plus,
  Edit2,
  Trash2,
  Activity,
  FileText,
  DollarSign,
  BarChart3,
  Download,
  DoorOpen,
  Stethoscope,
  ClipboardCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Package,
  Dumbbell,
} from "lucide-react";
import { toast } from "sonner";

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = "",
  children,
}) => (
  <div className={`rounded-xl border border-ink-800 bg-ink-900/90 ${className}`}>{children}</div>
);

const Badge: React.FC<{
  tone?: "amber" | "green" | "red" | "blue" | "gray";
  children: React.ReactNode;
}> = ({ tone = "gray", children }) => {
  const toneMap: Record<
    string,
    "neutral" | "accent" | "court" | "info" | "good" | "ok" | "warn" | "bad" | "danger"
  > = {
    amber: "warn",
    green: "ok",
    red: "danger",
    blue: "info",
    gray: "neutral",
  };
  return <Chip tone={toneMap[tone] || "neutral"}>{children}</Chip>;
};

const money = (amount: number) => kitMoney(amount);

const RTP_STAGES = [
  { stage: 1, title: "Stage 1 · Acute Pain & Edema Control" },
  { stage: 2, title: "Stage 2 · Mobility & Protected Loading" },
  { stage: 3, title: "Stage 3 · Progressive Strength & Neuromuscular Control" },
  { stage: 4, title: "Stage 4 · Sport-Specific Conditioning & Modified Practice" },
  { stage: 5, title: "Stage 5 · Full Medical Clearance & Return to Play" },
];

export interface NexusPhysioModuleProps {
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  externalIntakeOpen?: boolean;
  onExternalIntakeHandled?: () => void;
}

type PhysioSubTab =
  "schedule" | "patients" | "practitioners_rooms" | "billing_packages" | "analytics";

export const NexusPhysioModule: React.FC<NexusPhysioModuleProps> = ({
  selectedBranch,
  onSelectBranch,
  externalIntakeOpen,
  onExternalIntakeHandled,
}) => {
  const { db, tenantId, setEntity, patchEntity, deleteEntity, runBranchArrayTransaction } = useDB();
  const { role } = useAuth();
  const isSuperAdmin = role === "Super Admin";

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [activeSubTab, setActiveSubTab] = useState<PhysioSubTab>("schedule");

  const activeBranchName = useMemo(() => {
    if (selectedBranch !== "All") return selectedBranch;
    return db.branches[0]?.name || "Main Branch";
  }, [selectedBranch, db.branches]);

  const activeBranchObj = useMemo(() => {
    return db.branches.find((b) => b.name === activeBranchName) || db.branches[0];
  }, [db.branches, activeBranchName]);

  // Default seed Practitioners if branch has none configured yet
  const branchPractitioners = useMemo<PhysioPractitioner[]>(() => {
    const list: PhysioPractitioner[] = [];
    const targetBranches =
      selectedBranch === "All" ? db.branches : db.branches.filter((b) => b.name === selectedBranch);

    for (const b of targetBranches) {
      if (b.physioPractitioners && b.physioPractitioners.length > 0) {
        list.push(...b.physioPractitioners);
      } else {
        list.push(
          {
            id: `pract-default-1-${b.id}`,
            name: b.leadPhysiotherapist || "Dr. Rami Khoury (DPT)",
            title: "Lead Sports Physiotherapist (DPT, CSCS)",
            specialty: "ACL / Knee Rehab, Manual Therapy & Biomechanical RTP",
            phone: "+961 70 412 889",
            email: "rami.khoury@vescionexus.com",
            branch: b.name,
            workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
            workingHoursStart: "08:00",
            workingHoursEnd: "20:00",
            defaultSessionFee: 55,
            payoutModel: "Percentage Commission",
            commissionPct: 45,
            status: "Active",
            licenseNumber: "PT-LB-9941",
            createdAt: "2026-01-01T08:00:00.000Z",
          },
          {
            id: `pract-default-2-${b.id}`,
            name: "Dr. Maya Nassar (MD, Sports Med)",
            title: "Sports Medicine & Dry Needling Specialist",
            specialty: "Shoulder / Rotator Cuff, Spine & Electrotherapy",
            phone: "+961 71 883 210",
            email: "maya.nassar@vescionexus.com",
            branch: b.name,
            workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
            workingHoursStart: "09:00",
            workingHoursEnd: "18:00",
            defaultSessionFee: 65,
            payoutModel: "Fixed Per Session",
            commissionPct: 40,
            fixedPayoutPerSession: 30,
            status: "Active",
            licenseNumber: "MD-SM-4412",
            createdAt: "2026-01-01T08:00:00.000Z",
          },
        );
      }
    }
    return list;
  }, [db.branches, selectedBranch]);

  // Default seed Treatment Rooms / Cubicles per branch
  const branchRooms = useMemo<PhysioRoom[]>(() => {
    const list: PhysioRoom[] = [];
    const targetBranches =
      selectedBranch === "All" ? db.branches : db.branches.filter((b) => b.name === selectedBranch);

    for (const b of targetBranches) {
      if (b.physioRooms && b.physioRooms.length > 0) {
        list.push(...b.physioRooms);
      } else {
        list.push(
          {
            id: `room-1-${b.id}`,
            name: "Room 1 — Clinical Assessment Suite",
            roomType: "Private Assessment Room",
            branch: b.name,
            equipment: "Diagnostic Ultrasound, Goniometry, Treatment Plinth",
            status: "Available",
          },
          {
            id: `room-2-${b.id}`,
            name: "Cubicle A — Manual Therapy & Dry Needling",
            roomType: "Manual Therapy Cubicle",
            branch: b.name,
            equipment: "Electric Hi-Lo Plinth, IASTM Tools, Cupping & Needling Kit",
            status: "Available",
          },
          {
            id: `room-3-${b.id}`,
            name: "Cubicle B — Electrotherapy & Cryo Recovery",
            roomType: "Electrotherapy & Modalities Bay",
            branch: b.name,
            equipment: "Shockwave, TENS/EMS, GameReady Cryo-Compression",
            status: "Available",
          },
          {
            id: `room-4-${b.id}`,
            name: "Rehab Zone — Biomechanics & RTP Bay",
            roomType: "Rehab & Biomechanics Zone",
            branch: b.name,
            equipment: "Force Plates, Isokinetic Dynamometer, Keiser Functional Cable",
            status: "Available",
          },
        );
      }
    }
    return list;
  }, [db.branches, selectedBranch]);

  // Branch Rehab Packages
  const branchPackages = useMemo<PhysioPackageConfig[]>(() => {
    if (activeBranchObj?.physioPackages && activeBranchObj.physioPackages.length > 0) {
      return activeBranchObj.physioPackages;
    }
    return DEFAULT_PHYSIO_PACKAGES;
  }, [activeBranchObj]);

  // Filtered Patient Clinical Records
  const filteredPatients = useMemo<PhysioRecord[]>(() => {
    const all = db.physioRecords || [];
    if (selectedBranch === "All") return all;
    return all.filter((r) => r.branch === selectedBranch);
  }, [db.physioRecords, selectedBranch]);

  // Appointments across selected branch(es)
  const allAppointments = useMemo<PhysioAppointment[]>(() => {
    const list: PhysioAppointment[] = [];
    const seen = new Set<string>();
    const targetBranches =
      selectedBranch === "All" ? db.branches : db.branches.filter((b) => b.name === selectedBranch);

    for (const b of targetBranches) {
      for (const appt of b.physioAppointments || []) {
        if (!seen.has(appt.id)) {
          seen.add(appt.id);
          list.push(appt);
        }
      }
    }
    return list.sort((a, b) =>
      `${a.date}_${a.startTime}`.localeCompare(`${b.date}_${b.startTime}`),
    );
  }, [db.branches, selectedBranch]);

  // Helper to calculate Practitioner Payout for a session fee
  const calculatePractitionerPayout = (
    practitioner: PhysioPractitioner | undefined,
    sessionFee: number,
  ): number => {
    if (!practitioner) return Math.round(sessionFee * 0.4 * 100) / 100;
    if (practitioner.payoutModel === "Fixed Per Session") {
      return practitioner.fixedPayoutPerSession ?? 25;
    }
    return Math.round(sessionFee * ((practitioner.commissionPct || 40) / 100) * 100) / 100;
  };

  // Sync Academy Player Medical Clearance Status whenever a linked patient's medicalStatus changes
  const syncPlayerMedicalStatus = async (
    linkedPlayerId: string | undefined,
    medicalStatus: PlayerMedicalClearanceStatus,
    diagnosis: string,
  ) => {
    if (!linkedPlayerId) return;
    const player = db.players.find((p) => p.id === linkedPlayerId);
    if (!player) return;
    const currentStatusStr = player.status as string;
    const mappedPlayerStatus = (
      medicalStatus === "Injured"
        ? "Injured"
        : currentStatusStr === "Injured"
          ? "Active"
          : player.status
    ) as typeof player.status;
    await patchEntity("players", linkedPlayerId, {
      status: mappedPlayerStatus,
      medicalStatus,
      medicalNotes: `[Physio & Medical Center] ${medicalStatus}: ${diagnosis}`,
    });
  };

  // Persistence helpers on Branch (backed by atomic Firestore branch transactions)
  const savePractitionersToBranch = async (branchName: string, nextList: PhysioPractitioner[]) => {
    const target = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!target) return;
    await runBranchArrayTransaction(
      target.id,
      (curr) => ({
        ...curr,
        physioPractitioners: nextList,
      }),
      target,
    );
  };

  const saveRoomsToBranch = async (branchName: string, nextRooms: PhysioRoom[]) => {
    const target = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!target) return;
    await runBranchArrayTransaction(
      target.id,
      (curr) => ({
        ...curr,
        physioRooms: nextRooms,
        physioRoomsCount: nextRooms.length,
      }),
      target,
    );
  };

  const savePackagesToBranch = async (nextPackages: PhysioPackageConfig[]) => {
    if (!activeBranchObj) return;
    await runBranchArrayTransaction(
      activeBranchObj.id,
      (curr) => ({
        ...curr,
        physioPackages: nextPackages,
      }),
      activeBranchObj,
    );
  };

  const saveAppointmentToBranch = async (branchName: string, appointment: PhysioAppointment) => {
    const target = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!target) return;
    await runBranchArrayTransaction(
      target.id,
      (curr) => {
        const existing = curr.physioAppointments || [];
        const exists = existing.some((a) => a.id === appointment.id);
        const nextAppointments = exists
          ? existing.map((a) => (a.id === appointment.id ? appointment : a))
          : [...existing, appointment];
        return {
          ...curr,
          physioAppointments: nextAppointments,
        };
      },
      target,
    );
  };

  const deleteAppointmentFromBranch = async (branchName: string, appointmentId: string) => {
    const target = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!target) return;
    await runBranchArrayTransaction(
      target.id,
      (curr) => ({
        ...curr,
        physioAppointments: (curr.physioAppointments || []).filter((a) => a.id !== appointmentId),
      }),
      target,
    );
  };

  // ---------------------------------------------------------------------------
  // 1. COMPREHENSIVE PATIENT INTAKE & CLINICAL PROFILE STATE
  // ---------------------------------------------------------------------------
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [selectedPatientFileId, setSelectedPatientFileId] = useState<string>("");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientStatusFilter, setPatientStatusFilter] = useState<string>("All");

  const activePatientFile = useMemo<PhysioRecord | null>(() => {
    return (
      filteredPatients.find((p) => p.id === selectedPatientFileId) || filteredPatients[0] || null
    );
  }, [filteredPatients, selectedPatientFileId]);

  const [intakeForm, setIntakeForm] = useState<{
    patientName: string;
    patientType: "Academy Player" | "External Patient";
    linkedPlayerId: string;
    team: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    age: string;
    gender: "Male" | "Female" | "Other";
    address: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelation: string;
    medicalHistory: string;
    allergiesContraindications: string;
    surgicalHistory: string;
    currentMedications: string;
    referringDoctor: string;
    referringClinic: string;
    injuryArea: PhysioRecord["injuryArea"];
    primaryComplaint: string;
    diagnosis: string;
    mechanism: string;
    severity: PhysioRecord["severity"];
    medicalStatus: PlayerMedicalClearanceStatus;
    rtpStage: 1 | 2 | 3 | 4 | 5;
    restrictions: string;
    assignedPractitionerId: string;
    estimatedReturnDate: string;
    billingType: "Self-Pay" | "Rehab Package" | "Insurance" | "Academy Covered";
    insuranceProvider: string;
    insurancePolicyNumber: string;
    insuranceCoveragePct: number;
    packageId: string;
    branch: string;
    caseStatus: "Active Treatment" | "Maintenance / Rehab" | "Discharged" | "On Hold";
  }>({
    patientName: "",
    patientType: "External Patient",
    linkedPlayerId: "",
    team: "",
    phone: "",
    email: "",
    dateOfBirth: "",
    age: "",
    gender: "Male",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "Parent / Spouse",
    medicalHistory: "No chronic cardiovascular or metabolic disease.",
    allergiesContraindications: "No known drug/adhesive allergies; cleared for electrotherapy.",
    surgicalHistory: "",
    currentMedications: "",
    referringDoctor: "Dr. Antoine Frem (Orthopedic Surgery)",
    referringClinic: "",
    injuryArea: "Knee / ACL / Meniscus",
    primaryComplaint: "Anterior knee pain & instability under deceleration load",
    diagnosis: "Grade 1 Patellar Tendinopathy / Lateral Meniscus Irritation",
    mechanism: "Non-contact landing deceleration during match play",
    severity: "Moderate (Grade 2)",
    medicalStatus: "Limited",
    rtpStage: 2,
    restrictions: "No max-effort plyometrics or full-contact scrimmage; cleared for linear load",
    assignedPractitionerId: "",
    estimatedReturnDate: "",
    billingType: "Self-Pay",
    insuranceProvider: "",
    insurancePolicyNumber: "",
    insuranceCoveragePct: 80,
    packageId: "",
    branch: activeBranchName,
    caseStatus: "Active Treatment",
  });

  useEffect(() => {
    if (externalIntakeOpen) {
      openNewIntakeModal();
      onExternalIntakeHandled?.();
    }
  }, [externalIntakeOpen]);

  const openNewIntakeModal = () => {
    setEditingPatientId(null);
    setIntakeForm({
      patientName: "",
      patientType: "External Patient",
      linkedPlayerId: "",
      team: "",
      phone: "",
      email: "",
      dateOfBirth: "",
      age: "",
      gender: "Male",
      address: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelation: "Parent / Spouse",
      medicalHistory: "No chronic cardiovascular or metabolic conditions.",
      allergiesContraindications: "None reported; cleared for manual & electro-modalities.",
      surgicalHistory: "",
      currentMedications: "",
      referringDoctor: "",
      referringClinic: "",
      injuryArea: "Knee / ACL / Meniscus",
      primaryComplaint: "",
      diagnosis: "",
      mechanism: "",
      severity: "Moderate (Grade 2)",
      medicalStatus: "Limited",
      rtpStage: 2,
      restrictions: "Modified load; avoid high-impact pivoting until Stage 4.",
      assignedPractitionerId: branchPractitioners[0]?.id || "",
      estimatedReturnDate: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
      billingType: "Self-Pay",
      insuranceProvider: "",
      insurancePolicyNumber: "",
      insuranceCoveragePct: 80,
      packageId: "",
      branch: activeBranchName,
      caseStatus: "Active Treatment",
    });
    setIntakeModalOpen(true);
  };

  const openEditPatientModal = (rec: PhysioRecord) => {
    setEditingPatientId(rec.id);
    setIntakeForm({
      patientName: rec.patientName,
      patientType: rec.patientType,
      linkedPlayerId: rec.linkedPlayerId || "",
      team: rec.team || "",
      phone: rec.phone || "",
      email: rec.email || "",
      dateOfBirth: rec.dateOfBirth || "",
      age: rec.age !== undefined ? String(rec.age) : "",
      gender: rec.gender || "Male",
      address: rec.address || "",
      emergencyContactName: rec.emergencyContactName || "",
      emergencyContactPhone: rec.emergencyContactPhone || "",
      emergencyContactRelation: rec.emergencyContactRelation || "Parent / Spouse",
      medicalHistory: rec.medicalHistory || "",
      allergiesContraindications: rec.allergiesContraindications || "",
      surgicalHistory: rec.surgicalHistory || "",
      currentMedications: rec.currentMedications || "",
      referringDoctor: rec.referringDoctor || "",
      referringClinic: rec.referringClinic || "",
      injuryArea: rec.injuryArea,
      primaryComplaint: rec.primaryComplaint || "",
      diagnosis: rec.diagnosis,
      mechanism: rec.mechanism || "",
      severity: rec.severity,
      medicalStatus: rec.medicalStatus,
      rtpStage: rec.rtpStage,
      restrictions: rec.restrictions,
      assignedPractitionerId: rec.assignedPractitionerId || branchPractitioners[0]?.id || "",
      estimatedReturnDate: rec.estimatedReturnDate || "",
      billingType: rec.billingType || "Self-Pay",
      insuranceProvider: rec.insuranceProvider || "",
      insurancePolicyNumber: rec.insurancePolicyNumber || "",
      insuranceCoveragePct: rec.insuranceCoveragePct ?? 80,
      packageId: rec.activePackageId || "",
      branch: rec.branch,
      caseStatus: rec.caseStatus || "Active Treatment",
    });
    setIntakeModalOpen(true);
  };

  const handleSavePatientIntake = async () => {
    if (!intakeForm.patientName.trim()) {
      toast.error("Please enter the patient's full name.");
      return;
    }
    if (!intakeForm.diagnosis.trim() && !intakeForm.primaryComplaint.trim()) {
      toast.error("Please enter the primary complaint or clinical diagnosis.");
      return;
    }

    const practitioner =
      branchPractitioners.find((p) => p.id === intakeForm.assignedPractitionerId) ||
      branchPractitioners[0];

    const selectedPkg =
      intakeForm.billingType === "Rehab Package"
        ? branchPackages.find((pkg) => pkg.id === intakeForm.packageId) || branchPackages[2]
        : undefined;

    const existing = editingPatientId
      ? (db.physioRecords || []).find((r) => r.id === editingPatientId)
      : undefined;

    const nowIso = new Date().toISOString();
    const record: PhysioRecord = {
      id: existing ? existing.id : `physio-pat-${Date.now()}`,
      patientName: intakeForm.patientName.trim(),
      patientType: intakeForm.patientType,
      linkedPlayerId: intakeForm.linkedPlayerId || undefined,
      team: intakeForm.team || undefined,
      phone: intakeForm.phone.trim() || undefined,
      email: intakeForm.email.trim() || undefined,
      dateOfBirth: intakeForm.dateOfBirth || undefined,
      age: intakeForm.age ? Number(intakeForm.age) : undefined,
      gender: intakeForm.gender,
      address: intakeForm.address.trim() || undefined,
      emergencyContactName: intakeForm.emergencyContactName.trim() || undefined,
      emergencyContactPhone: intakeForm.emergencyContactPhone.trim() || undefined,
      emergencyContactRelation: intakeForm.emergencyContactRelation.trim() || undefined,
      medicalHistory: intakeForm.medicalHistory.trim() || undefined,
      allergiesContraindications: intakeForm.allergiesContraindications.trim() || undefined,
      surgicalHistory: intakeForm.surgicalHistory.trim() || undefined,
      currentMedications: intakeForm.currentMedications.trim() || undefined,
      referringDoctor: intakeForm.referringDoctor.trim() || undefined,
      referringClinic: intakeForm.referringClinic.trim() || undefined,
      billingType: intakeForm.billingType,
      insuranceProvider:
        intakeForm.billingType === "Insurance"
          ? intakeForm.insuranceProvider.trim() || "Medical Insurance"
          : undefined,
      insurancePolicyNumber:
        intakeForm.billingType === "Insurance"
          ? intakeForm.insurancePolicyNumber.trim()
          : undefined,
      insuranceCoveragePct:
        intakeForm.billingType === "Insurance"
          ? Number(intakeForm.insuranceCoveragePct) || 80
          : undefined,
      activePackageId: selectedPkg ? selectedPkg.id : existing?.activePackageId,
      activePackageName: selectedPkg ? selectedPkg.name : existing?.activePackageName,
      packageSessionsRemaining: selectedPkg
        ? (existing?.packageSessionsRemaining ?? selectedPkg.sessionsIncluded)
        : existing?.packageSessionsRemaining,
      packageSessionsTotal: selectedPkg
        ? (existing?.packageSessionsTotal ?? selectedPkg.sessionsIncluded)
        : existing?.packageSessionsTotal,
      totalBilled: existing ? existing.totalBilled : selectedPkg ? selectedPkg.price : 0,
      totalPaid: existing ? existing.totalPaid : selectedPkg ? selectedPkg.price : 0,
      balanceDue: existing?.balanceDue || 0,
      branch: intakeForm.branch || activeBranchName,
      caseStatus: intakeForm.caseStatus,
      dischargeDate:
        intakeForm.caseStatus === "Discharged" ? existing?.dischargeDate || todayStr : undefined,
      medicalStatus: intakeForm.medicalStatus,
      injuryArea: intakeForm.injuryArea,
      primaryComplaint: intakeForm.primaryComplaint.trim() || intakeForm.diagnosis.trim(),
      diagnosis: intakeForm.diagnosis.trim() || intakeForm.primaryComplaint.trim(),
      mechanism: intakeForm.mechanism.trim() || undefined,
      severity: intakeForm.severity,
      intakeDate: existing?.intakeDate || todayStr,
      estimatedReturnDate: intakeForm.estimatedReturnDate || undefined,
      assignedPractitionerId: practitioner?.id,
      therapistName: practitioner?.name || "Dr. Rami Khoury (DPT)",
      rtpStage: intakeForm.rtpStage,
      restrictions: intakeForm.restrictions.trim(),
      rehabExercises: existing?.rehabExercises || [],
      treatmentSessions: existing?.treatmentSessions || [],
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      await setEntity("physioRecords", record);
      await syncPlayerMedicalStatus(record.linkedPlayerId, record.medicalStatus, record.diagnosis);

      // If new patient purchased a Rehab Package at intake, post revenue to Ledger
      if (!existing && selectedPkg && selectedPkg.price > 0) {
        const ledgerEntry: LedgerEntry = normalizeDoubleEntryLedger({
          id: `led-physio-pkg-${Date.now()}`,
          date: todayStr,
          account: "Physiotherapy & Medical Revenue",
          category: "Physiotherapy",
          module: "physio",
          entry: `[Vescio Nexus Physio Package] ${record.patientName} — ${selectedPkg.name} (${record.branch})`,
          memo: `[Vescio Nexus Physio Package] ${record.patientName} — ${selectedPkg.name}`,
          type: "Revenue",
          amount: selectedPkg.price,
          status: "Collected",
          branch: record.branch,
          referenceId: record.id,
        });
        await setEntity("ledger", ledgerEntry);
      }

      setSelectedPatientFileId(record.id);
      setIntakeModalOpen(false);
      toast.success(
        existing
          ? `Updated clinical profile for ${record.patientName}`
          : `Registered patient ${record.patientName} (${record.injuryArea})`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save patient profile.");
    }
  };

  // Rehab Exercise Prescription Modal for Active Patient File
  const [exerciseModalOpen, setExerciseModalOpen] = useState(false);
  const [exerciseForm, setExerciseForm] = useState<{
    exerciseName: string;
    setsRepsTempo: string;
    frequency: string;
    targetGoal: string;
    precautions: string;
  }>({
    exerciseName: "Spanish Squat Isometric Hold",
    setsRepsTempo: "4 sets x 45 sec hold @ 70% effort",
    frequency: "Daily (Pre-training & Evening)",
    targetGoal: "Patellar tendon analgesia & quad torque restoration",
    precautions: "Keep pain score ≤ 3/10 during loading",
  });

  const handleAddExercisePrescription = async () => {
    if (!activePatientFile) return;
    if (!exerciseForm.exerciseName.trim()) {
      toast.error("Please enter an exercise name.");
      return;
    }
    const newEx: PhysioExercisePrescription = {
      id: `rx-ex-${Date.now()}`,
      exerciseName: exerciseForm.exerciseName.trim(),
      setsRepsTempo: exerciseForm.setsRepsTempo.trim() || "3 x 12",
      frequency: exerciseForm.frequency.trim() || "Daily",
      targetGoal: exerciseForm.targetGoal.trim() || undefined,
      precautions: exerciseForm.precautions.trim() || undefined,
    };
    try {
      await setEntity("physioRecords", {
        ...activePatientFile,
        rehabExercises: [newEx, ...(activePatientFile.rehabExercises || [])],
        updatedAt: new Date().toISOString(),
      });
      setExerciseModalOpen(false);
      toast.success(`Prescribed "${newEx.exerciseName}" to ${activePatientFile.patientName}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save exercise prescription.");
    }
  };

  // ---------------------------------------------------------------------------
  // 2. PRACTITIONERS & TREATMENT ROOMS MANAGEMENT STATE
  // ---------------------------------------------------------------------------
  const [practitionerModalOpen, setPractitionerModalOpen] = useState(false);
  const [editingPractitionerId, setEditingPractitionerId] = useState<string | null>(null);
  const [practitionerForm, setPractitionerForm] = useState<{
    name: string;
    title: string;
    specialty: string;
    phone: string;
    email: string;
    branch: string;
    workingHoursStart: string;
    workingHoursEnd: string;
    defaultSessionFee: number;
    payoutModel: "Percentage Commission" | "Fixed Per Session";
    commissionPct: number;
    fixedPayoutPerSession: number;
    status: "Active" | "On Leave" | "Inactive";
    licenseNumber: string;
  }>({
    name: "",
    title: "Senior Sports Physiotherapist (DPT)",
    specialty: "Orthopedic Rehab, Manual Therapy & Biomechanics",
    phone: "",
    email: "",
    branch: activeBranchName,
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    defaultSessionFee: 55,
    payoutModel: "Percentage Commission",
    commissionPct: 45,
    fixedPayoutPerSession: 25,
    status: "Active",
    licenseNumber: "",
  });

  const openNewPractitionerModal = () => {
    setEditingPractitionerId(null);
    setPractitionerForm({
      name: "",
      title: "Senior Sports Physiotherapist (DPT)",
      specialty: "Orthopedic & Sports Injury Rehabilitation",
      phone: "",
      email: "",
      branch: activeBranchName,
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      defaultSessionFee: 55,
      payoutModel: "Percentage Commission",
      commissionPct: 45,
      fixedPayoutPerSession: 25,
      status: "Active",
      licenseNumber: "",
    });
    setPractitionerModalOpen(true);
  };

  const openEditPractitionerModal = (p: PhysioPractitioner) => {
    setEditingPractitionerId(p.id);
    setPractitionerForm({
      name: p.name,
      title: p.title,
      specialty: p.specialty,
      phone: p.phone,
      email: p.email || "",
      branch: p.branch,
      workingHoursStart: p.workingHoursStart,
      workingHoursEnd: p.workingHoursEnd,
      defaultSessionFee: p.defaultSessionFee,
      payoutModel: p.payoutModel,
      commissionPct: p.commissionPct,
      fixedPayoutPerSession: p.fixedPayoutPerSession || 25,
      status: p.status,
      licenseNumber: p.licenseNumber || "",
    });
    setPractitionerModalOpen(true);
  };

  const handleSavePractitioner = async () => {
    if (!practitionerForm.name.trim()) {
      toast.error("Please enter the practitioner's name.");
      return;
    }
    const targetBranchName = practitionerForm.branch || activeBranchName;
    const currentInBranch = branchPractitioners.filter((p) => p.branch === targetBranchName);

    const record: PhysioPractitioner = {
      id: editingPractitionerId || `pract-${Date.now()}`,
      name: practitionerForm.name.trim(),
      title: practitionerForm.title.trim() || "Sports Physiotherapist",
      specialty: practitionerForm.specialty.trim() || "General Physiotherapy",
      phone: practitionerForm.phone.trim() || "—",
      email: practitionerForm.email.trim() || undefined,
      branch: targetBranchName,
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      workingHoursStart: practitionerForm.workingHoursStart || "09:00",
      workingHoursEnd: practitionerForm.workingHoursEnd || "18:00",
      defaultSessionFee: Number(practitionerForm.defaultSessionFee) || 50,
      payoutModel: practitionerForm.payoutModel,
      commissionPct: Number(practitionerForm.commissionPct) || 40,
      fixedPayoutPerSession: Number(practitionerForm.fixedPayoutPerSession) || 25,
      status: practitionerForm.status,
      licenseNumber: practitionerForm.licenseNumber.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const exists = currentInBranch.some((p) => p.id === record.id);
    const nextList = exists
      ? currentInBranch.map((p) => (p.id === record.id ? record : p))
      : [...currentInBranch, record];

    try {
      await savePractitionersToBranch(targetBranchName, nextList);
      setPractitionerModalOpen(false);
      toast.success(
        exists ? `Updated practitioner ${record.name}` : `Added practitioner ${record.name}`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save practitioner.");
    }
  };

  // Room / Cubicle Modal State
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState<{
    name: string;
    roomType: PhysioRoom["roomType"];
    branch: string;
    equipment: string;
    status: "Available" | "Maintenance";
  }>({
    name: "",
    roomType: "Manual Therapy Cubicle",
    branch: activeBranchName,
    equipment: "Hi-Lo Plinth, Electrotherapy Unit, Manual Therapy Kit",
    status: "Available",
  });

  const openNewRoomModal = () => {
    setEditingRoomId(null);
    setRoomForm({
      name: `Cubicle ${branchRooms.length + 1} — Treatment Bay`,
      roomType: "Manual Therapy Cubicle",
      branch: activeBranchName,
      equipment: "Electric Plinth, Ultrasound & TENS/EMS, Dry Needling Kit",
      status: "Available",
    });
    setRoomModalOpen(true);
  };

  const openEditRoomModal = (room: PhysioRoom) => {
    setEditingRoomId(room.id);
    setRoomForm({
      name: room.name,
      roomType: room.roomType,
      branch: room.branch,
      equipment: room.equipment,
      status: room.status,
    });
    setRoomModalOpen(true);
  };

  const handleSaveRoom = async () => {
    if (!roomForm.name.trim()) {
      toast.error("Please enter a treatment room or cubicle name.");
      return;
    }
    const targetBranchName = roomForm.branch || activeBranchName;
    const currentInBranch = branchRooms.filter((r) => r.branch === targetBranchName);

    const record: PhysioRoom = {
      id: editingRoomId || `physio-room-${Date.now()}`,
      name: roomForm.name.trim(),
      roomType: roomForm.roomType,
      branch: targetBranchName,
      equipment: roomForm.equipment.trim() || "Standard Treatment Plinth",
      status: roomForm.status,
    };

    const exists = currentInBranch.some((r) => r.id === record.id);
    const nextRooms = exists
      ? currentInBranch.map((r) => (r.id === record.id ? record : r))
      : [...currentInBranch, record];

    try {
      await saveRoomsToBranch(targetBranchName, nextRooms);
      setRoomModalOpen(false);
      toast.success(exists ? `Updated ${record.name}` : `Created ${record.name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save treatment room.");
    }
  };

  // ---------------------------------------------------------------------------
  // 3. APPOINTMENT SCHEDULING, DOUBLE-BOOKING PREVENTION & SESSION WORKFLOW
  // ---------------------------------------------------------------------------
  const [scheduleDate, setScheduleDate] = useState<string>(todayStr);
  const [filterPractitionerId, setFilterPractitionerId] = useState<string>("All");
  const [filterRoomId, setFilterRoomId] = useState<string>("All");
  const [filterApptStatus, setFilterApptStatus] = useState<string>("All");

  const activeDateOffDay = useMemo(() => {
    return (activeBranchObj?.offDays || []).find((od) => od.date === scheduleDate);
  }, [activeBranchObj, scheduleDate]);

  const appointmentsForSelectedDate = useMemo(() => {
    return allAppointments.filter((a) => {
      if (a.date !== scheduleDate) return false;
      if (filterPractitionerId !== "All" && a.practitionerId !== filterPractitionerId) return false;
      if (filterRoomId !== "All" && a.roomId !== filterRoomId) return false;
      if (filterApptStatus !== "All" && a.status !== filterApptStatus) return false;
      return true;
    });
  }, [allAppointments, scheduleDate, filterPractitionerId, filterRoomId, filterApptStatus]);

  // Helper to check if two [startTime, endTime) ranges overlap
  const timesOverlap = (startA: string, endA: string, startB: string, endB: string): boolean => {
    return startA < endB && startB < endA;
  };

  // Booking Modal State
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [apptForm, setApptForm] = useState<{
    patientRecordId: string;
    practitionerId: string;
    roomId: string;
    date: string;
    startTime: string;
    endTime: string;
    appointmentType: PhysioAppointment["appointmentType"];
    modality: string;
    fee: number;
    paymentStatus: PhysioAppointment["paymentStatus"];
    notes: string;
  }>({
    patientRecordId: "",
    practitionerId: "",
    roomId: "",
    date: todayStr,
    startTime: "10:00",
    endTime: "10:45",
    appointmentType: "Follow-Up Treatment",
    modality: "Manual Therapy & Mobilization",
    fee: 55,
    paymentStatus: "Pending",
    notes: "",
  });

  const openBookAppointmentModal = (presetPatient?: PhysioRecord) => {
    const pat = presetPatient || filteredPatients[0];
    const pract =
      branchPractitioners.find((p) => p.id === pat?.assignedPractitionerId) ||
      branchPractitioners[0];
    const availRoom = branchRooms.find((r) => r.status === "Available") || branchRooms[0];
    const hasPackageCredits = (pat?.packageSessionsRemaining || 0) > 0;

    setApptForm({
      patientRecordId: pat?.id || "",
      practitionerId: pract?.id || "",
      roomId: availRoom?.id || "",
      date: scheduleDate,
      startTime: "10:00",
      endTime: "10:45",
      appointmentType:
        (pat?.treatmentSessions || []).length === 0 ? "Initial Assessment" : "Follow-Up Treatment",
      modality: "Manual Therapy & Mobilization",
      fee: pract?.defaultSessionFee || 55,
      paymentStatus: hasPackageCredits
        ? "Package Deducted"
        : pat?.billingType === "Academy Covered"
          ? "Academy Covered"
          : pat?.billingType === "Insurance"
            ? "Insurance Covered"
            : "Pending",
      notes: "",
    });
    setApptModalOpen(true);
  };

  // Live conflict check for currently selected room & practitioner in booking modal
  const liveBookingConflict = useMemo(() => {
    if (!apptModalOpen) return null;
    const sameDayAppts = allAppointments.filter(
      (a) => a.date === apptForm.date && a.status !== "Cancelled",
    );

    const roomConflict = sameDayAppts.find(
      (a) =>
        a.roomId === apptForm.roomId &&
        timesOverlap(apptForm.startTime, apptForm.endTime, a.startTime, a.endTime),
    );
    if (roomConflict) {
      return `Room Conflict: ${roomConflict.roomName} is already booked from ${roomConflict.startTime} to ${roomConflict.endTime} for ${roomConflict.patientName}.`;
    }

    const practConflict = sameDayAppts.find(
      (a) =>
        a.practitionerId === apptForm.practitionerId &&
        timesOverlap(apptForm.startTime, apptForm.endTime, a.startTime, a.endTime),
    );
    if (practConflict) {
      return `Practitioner Conflict: ${practConflict.practitionerName} is already booked from ${practConflict.startTime} to ${practConflict.endTime} with ${practConflict.patientName}.`;
    }

    const selectedRoom = branchRooms.find((r) => r.id === apptForm.roomId);
    if (selectedRoom?.status === "Maintenance") {
      return `Room Unavailable: ${selectedRoom.name} is currently marked under Maintenance.`;
    }

    return null;
  }, [apptModalOpen, allAppointments, apptForm, branchRooms]);

  const handleSaveAppointment = async () => {
    if (!apptForm.patientRecordId) {
      toast.error("Please select a registered patient (or complete Patient Intake first).");
      return;
    }
    if (!apptForm.practitionerId || !apptForm.roomId) {
      toast.error("Please select both a Practitioner and a Treatment Room/Cubicle.");
      return;
    }
    if (apptForm.startTime >= apptForm.endTime) {
      toast.error("End time must be after start time.");
      return;
    }
    if (liveBookingConflict) {
      toast.error(liveBookingConflict);
      return;
    }

    const patient = filteredPatients.find((p) => p.id === apptForm.patientRecordId);
    const practitioner = branchPractitioners.find((p) => p.id === apptForm.practitionerId);
    const room = branchRooms.find((r) => r.id === apptForm.roomId);
    if (!patient || !practitioner || !room) return;

    const targetBranch =
      db.branches.find((b) => b.name === (patient.branch || activeBranchName)) || activeBranchObj;
    const offDay = (targetBranch?.offDays || []).find((od) => od.date === apptForm.date);
    if (offDay) {
      toast.error(`Cannot book on ${apptForm.date}: Branch Off Day (${offDay.reason}).`);
      return;
    }

    const payout = calculatePractitionerPayout(practitioner, Number(apptForm.fee) || 0);
    const apptId = `physio-appt-${Date.now()}`;

    const newAppt: PhysioAppointment = {
      id: apptId,
      branch: patient.branch || activeBranchName,
      patientRecordId: patient.id,
      patientName: patient.patientName,
      patientPhone: patient.phone,
      practitionerId: practitioner.id,
      practitionerName: practitioner.name,
      roomId: room.id,
      roomName: room.name,
      date: apptForm.date,
      startTime: apptForm.startTime,
      endTime: apptForm.endTime,
      appointmentType: apptForm.appointmentType,
      modality: apptForm.modality,
      status: "Scheduled",
      fee: Number(apptForm.fee) || 50,
      paymentStatus: apptForm.paymentStatus,
      invoiceNumber: `INV-PHY-${Date.now().toString().slice(-5)}`,
      practitionerPayoutAmount: payout,
      notes: apptForm.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const sessionEntry: PhysioTreatmentSession = {
      id: `sess-${apptId}`,
      appointmentId: apptId,
      date: newAppt.date,
      time: newAppt.startTime,
      endTime: newAppt.endTime,
      therapistName: practitioner.name,
      practitionerId: practitioner.id,
      roomId: room.id,
      roomName: room.name,
      sessionType: newAppt.appointmentType,
      modality: newAppt.modality,
      soapNotes: apptForm.notes.trim() || "Scheduled clinical session",
      painScore: 4,
      fee: newAppt.fee,
      practitionerPayout: payout,
      invoiceNumber: newAppt.invoiceNumber,
      paymentStatus: newAppt.paymentStatus,
      status: "Scheduled",
    };

    if (!targetBranch) {
      toast.error("Active branch record not found.");
      return;
    }

    try {
      const { updatedBranch, updatedPatient } = await atomicBookPhysioAppointmentTransaction({
        tenantId,
        branchId: targetBranch.id,
        fallbackBranch: {
          ...targetBranch,
          physioRooms: branchRooms.filter((r) => r.branch === targetBranch.name),
          physioPractitioners: branchPractitioners.filter((p) => p.branch === targetBranch.name),
        },
        appointment: newAppt,
        patientId: patient.id,
        fallbackPatient: patient,
        linkedTreatmentSession: sessionEntry,
      });

      await setEntity("branches", updatedBranch);
      if (updatedPatient) {
        await setEntity("physioRecords", updatedPatient);
      }

      setApptModalOpen(false);
      toast.success(
        `Booked ${newAppt.appointmentType} for ${patient.patientName} in ${room.name} with ${practitioner.name}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to book appointment.";
      toast.error(msg);
    }
  };

  // Status Transition & Clinical SOAP Completion Modal
  const [completingAppt, setCompletingAppt] = useState<PhysioAppointment | null>(null);
  const [soapCompletionForm, setSoapCompletionForm] = useState<{
    soapSubjective: string;
    soapObjective: string;
    soapAssessment: string;
    soapPlan: string;
    exercisePrescription: string;
    painScore: number;
    paymentStatus: PhysioAppointment["paymentStatus"];
    collectPaymentNow: boolean;
    nextRtpStage: 1 | 2 | 3 | 4 | 5;
    nextMedicalStatus: PlayerMedicalClearanceStatus;
  }>({
    soapSubjective:
      "Patient reports 30% reduction in morning stiffness and improved weight-bearing tolerance.",
    soapObjective:
      "ROM knee flexion 0–125 deg (+10 deg); minimal effusion; quad isometric symmetry 84%.",
    soapAssessment: "Positive tissue adaptation to Stage 2 progressive tendon loading.",
    soapPlan: "Advance eccentric split-squat load by 10%; continue manual mobilization 2x/week.",
    exercisePrescription: "Spanish Squat Isometric 4x45s, Tempo Step-Downs 3x10, Calf Raises 3x15",
    painScore: 3,
    paymentStatus: "Paid",
    collectPaymentNow: true,
    nextRtpStage: 3,
    nextMedicalStatus: "Limited",
  });

  const handleTransitionApptStatus = async (
    appt: PhysioAppointment,
    nextStatus: PhysioAppointmentStatus,
  ) => {
    if (nextStatus === "Completed") {
      const pat = filteredPatients.find((p) => p.id === appt.patientRecordId);
      const hasPkg = (pat?.packageSessionsRemaining || 0) > 0;
      setCompletingAppt(appt);
      setSoapCompletionForm({
        soapSubjective:
          appt.soapSubjective ||
          "Patient reports decreased localized pain during functional movement.",
        soapObjective:
          appt.soapObjective ||
          "Improved joint ROM (+10°), clean manual resistance test, reduced tenderness on palpation.",
        soapAssessment:
          appt.soapAssessment ||
          "Responding well to manual therapy and progressive loading protocol.",
        soapPlan:
          appt.soapPlan ||
          "Continue structured home exercise program and progress to next RTP load phase.",
        exercisePrescription:
          appt.exercisePrescription ||
          "Isometric holds 4x45s, Eccentric control 3x10 @ Tempo 3-1-1",
        painScore: appt.painScore ?? 3,
        paymentStatus: hasPkg ? "Package Deducted" : "Paid",
        collectPaymentNow: !hasPkg,
        nextRtpStage: pat?.rtpStage || 2,
        nextMedicalStatus: pat?.medicalStatus || "Limited",
      });
      return;
    }

    const updatedAppt: PhysioAppointment = {
      ...appt,
      status: nextStatus,
    };
    try {
      await saveAppointmentToBranch(appt.branch, updatedAppt);

      const pat = filteredPatients.find((p) => p.id === appt.patientRecordId);
      if (pat) {
        await setEntity("physioRecords", {
          ...pat,
          treatmentSessions: (pat.treatmentSessions || []).map((s) =>
            s.appointmentId === appt.id ? { ...s, status: nextStatus } : s,
          ),
          updatedAt: new Date().toISOString(),
        });
      }
      toast.success(`Updated appointment status for ${appt.patientName} to "${nextStatus}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update appointment status.");
    }
  };

  const handleConfirmCompleteSessionWithSoap = async () => {
    if (!completingAppt) return;
    const pat = filteredPatients.find((p) => p.id === completingAppt.patientRecordId);
    const pract = branchPractitioners.find((p) => p.id === completingAppt.practitionerId);
    const payout = calculatePractitionerPayout(pract, completingAppt.fee);

    const combinedSoap = `S: ${soapCompletionForm.soapSubjective} | O: ${soapCompletionForm.soapObjective} | A: ${soapCompletionForm.soapAssessment} | P: ${soapCompletionForm.soapPlan}`;

    const finalPaymentStatus = soapCompletionForm.paymentStatus;
    const updatedAppt: PhysioAppointment = {
      ...completingAppt,
      status: "Completed",
      paymentStatus: finalPaymentStatus,
      practitionerPayoutAmount: payout,
      soapSubjective: soapCompletionForm.soapSubjective,
      soapObjective: soapCompletionForm.soapObjective,
      soapAssessment: soapCompletionForm.soapAssessment,
      soapPlan: soapCompletionForm.soapPlan,
      exercisePrescription: soapCompletionForm.exercisePrescription,
      painScore: Number(soapCompletionForm.painScore) || 0,
    };

    try {
      await saveAppointmentToBranch(updatedAppt.branch, updatedAppt);

      if (pat) {
        const deductPkg =
          finalPaymentStatus === "Package Deducted" && (pat.packageSessionsRemaining || 0) > 0;
        const nextPkgRem = deductPkg
          ? Math.max(0, (pat.packageSessionsRemaining || 0) - 1)
          : pat.packageSessionsRemaining;

        const isPaidCashOrCard =
          finalPaymentStatus === "Paid" && soapCompletionForm.collectPaymentNow;
        const isPending =
          finalPaymentStatus === "Pending" || finalPaymentStatus === "Charged to Account";

        const existingSessionMatch = (pat.treatmentSessions || []).some(
          (s) => s.appointmentId === updatedAppt.id,
        );

        const completedSessionObj: PhysioTreatmentSession = {
          id: `sess-${updatedAppt.id}`,
          appointmentId: updatedAppt.id,
          date: updatedAppt.date,
          time: updatedAppt.startTime,
          endTime: updatedAppt.endTime,
          therapistName: updatedAppt.practitionerName,
          practitionerId: updatedAppt.practitionerId,
          roomId: updatedAppt.roomId,
          roomName: updatedAppt.roomName,
          sessionType: updatedAppt.appointmentType,
          modality: updatedAppt.modality,
          soapNotes: combinedSoap,
          soapSubjective: soapCompletionForm.soapSubjective,
          soapObjective: soapCompletionForm.soapObjective,
          soapAssessment: soapCompletionForm.soapAssessment,
          soapPlan: soapCompletionForm.soapPlan,
          exercisePrescription: soapCompletionForm.exercisePrescription,
          painScore: Number(soapCompletionForm.painScore) || 0,
          fee: updatedAppt.fee,
          practitionerPayout: payout,
          invoiceNumber: updatedAppt.invoiceNumber,
          paymentStatus: finalPaymentStatus,
          status: "Completed",
        };

        const nextSessions = existingSessionMatch
          ? (pat.treatmentSessions || []).map((s) =>
              s.appointmentId === updatedAppt.id ? completedSessionObj : s,
            )
          : [completedSessionObj, ...(pat.treatmentSessions || [])];

        const updatedPatient: PhysioRecord = {
          ...pat,
          packageSessionsRemaining: nextPkgRem,
          rtpStage: soapCompletionForm.nextRtpStage,
          medicalStatus: soapCompletionForm.nextMedicalStatus,
          caseStatus:
            soapCompletionForm.nextMedicalStatus === "Fit" && soapCompletionForm.nextRtpStage === 5
              ? "Discharged"
              : pat.caseStatus,
          totalBilled: (pat.totalBilled || 0) + (deductPkg ? 0 : updatedAppt.fee),
          totalPaid: (pat.totalPaid || 0) + (isPaidCashOrCard ? updatedAppt.fee : 0),
          balanceDue: (pat.balanceDue || 0) + (isPending ? updatedAppt.fee : 0),
          treatmentSessions: nextSessions,
          updatedAt: new Date().toISOString(),
        };

        await setEntity("physioRecords", updatedPatient);
        await syncPlayerMedicalStatus(
          updatedPatient.linkedPlayerId,
          updatedPatient.medicalStatus,
          updatedPatient.diagnosis,
        );

        if (isPaidCashOrCard && updatedAppt.fee > 0) {
          const ledgerEntry: LedgerEntry = normalizeDoubleEntryLedger({
            id: `led-physio-sess-${Date.now()}`,
            date: updatedAppt.date,
            account: "Physiotherapy & Medical Revenue",
            category: "Physiotherapy",
            module: "physio",
            entry: `[Vescio Nexus Physio] ${updatedAppt.patientName} — ${updatedAppt.appointmentType} (${updatedAppt.practitionerName})`,
            memo: `[Vescio Nexus Physio] ${updatedAppt.patientName} — ${updatedAppt.appointmentType}`,
            type: "Revenue",
            amount: updatedAppt.fee,
            status: "Collected",
            branch: updatedAppt.branch || updatedPatient.branch || activeBranchName,
            referenceId: updatedAppt.id,
          });
          await setEntity("ledger", ledgerEntry);
        }
      }

      if (payout > 0) {
        const commissionEntry: LedgerEntry = normalizeDoubleEntryLedger({
          id: `led-physio-comm-${Date.now()}`,
          date: updatedAppt.date,
          account: "Physiotherapy Practitioner Commissions",
          category: "Physiotherapy",
          module: "physio",
          entry: `[Vescio Nexus Physio Commission] ${updatedAppt.practitionerName} — Session for ${updatedAppt.patientName}`,
          memo: `[Vescio Nexus Physio Commission] ${updatedAppt.practitionerName} (${updatedAppt.appointmentType})`,
          type: "Expense",
          amount: payout,
          status: "Paid",
          branch: updatedAppt.branch || pat?.branch || activeBranchName,
          referenceId: updatedAppt.id,
        });
        await setEntity("ledger", commissionEntry);
      }

      setCompletingAppt(null);
      toast.success(
        `Session completed & SOAP charted for ${updatedAppt.patientName} · Practitioner payout ${money(payout)} logged`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to complete session.");
    }
  };

  // ---------------------------------------------------------------------------
  // 4. BILLING, MULTI-SESSION REHAB PACKAGES & ANALYTICS
  // ---------------------------------------------------------------------------
  const [assignPkgPatient, setAssignPkgPatient] = useState<PhysioRecord | null>(null);
  const [assignPkgId, setAssignPkgId] = useState<string>(DEFAULT_PHYSIO_PACKAGES[2].id);
  const [assignPkgPaidNow, setAssignPkgPaidNow] = useState<boolean>(true);

  const handleAssignPackageToPatient = async () => {
    if (!assignPkgPatient) return;
    const pkg = branchPackages.find((p) => p.id === assignPkgId) || DEFAULT_PHYSIO_PACKAGES[2];
    if (!pkg) return;

    const updated: PhysioRecord = {
      ...assignPkgPatient,
      billingType: "Rehab Package",
      activePackageId: pkg.id,
      activePackageName: pkg.name,
      packageSessionsRemaining:
        (assignPkgPatient.packageSessionsRemaining || 0) + pkg.sessionsIncluded,
      packageSessionsTotal: (assignPkgPatient.packageSessionsTotal || 0) + pkg.sessionsIncluded,
      totalBilled: (assignPkgPatient.totalBilled || 0) + pkg.price,
      totalPaid: (assignPkgPatient.totalPaid || 0) + (assignPkgPaidNow ? pkg.price : 0),
      balanceDue: (assignPkgPatient.balanceDue || 0) + (assignPkgPaidNow ? 0 : pkg.price),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setEntity("physioRecords", updated);

      if (assignPkgPaidNow && pkg.price > 0) {
        await setEntity(
          "ledger",
          normalizeDoubleEntryLedger({
            id: `led-physio-pack-${Date.now()}`,
            date: todayStr,
            account: "Physiotherapy & Medical Revenue",
            category: "Physiotherapy",
            module: "physio",
            entry: `[Vescio Nexus Rehab Package] ${assignPkgPatient.patientName} purchased ${pkg.name} (+${pkg.sessionsIncluded} sessions)`,
            memo: `[Vescio Nexus Rehab Package] ${assignPkgPatient.patientName} — ${pkg.name}`,
            type: "Revenue",
            amount: pkg.price,
            status: "Collected",
            branch: assignPkgPatient.branch || activeBranchName,
            referenceId: assignPkgPatient.id,
          }),
        );
      }

      setAssignPkgPatient(null);
      toast.success(
        `Assigned ${pkg.name} (+${pkg.sessionsIncluded} sessions) to ${assignPkgPatient.patientName}`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to assign package.");
    }
  };

  const handleCollectPatientBalanceDue = async (patient: PhysioRecord) => {
    const due = Number(patient.balanceDue) || 0;
    if (due <= 0) return;
    try {
      const updated: PhysioRecord = {
        ...patient,
        totalPaid: (patient.totalPaid || 0) + due,
        balanceDue: 0,
        updatedAt: new Date().toISOString(),
      };
      await setEntity("physioRecords", updated);
      await setEntity(
        "ledger",
        normalizeDoubleEntryLedger({
          id: `led-physio-settle-${Date.now()}`,
          date: todayStr,
          account: "Physiotherapy & Medical Revenue",
          category: "Physiotherapy",
          module: "physio",
          entry: `[Vescio Nexus Physio Balance Collected] ${patient.patientName} (${patient.branch})`,
          memo: `[Vescio Nexus Physio Balance Collected] ${patient.patientName}`,
          type: "Revenue",
          amount: due,
          status: "Collected",
          branch: patient.branch || activeBranchName,
          referenceId: patient.id,
        }),
      );
      toast.success(
        `Collected ${money(due)} balance due for ${patient.patientName} to the Financial Ledger`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to collect balance due.");
    }
  };

  // Custom Rehab Package Creation Modal
  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [pkgForm, setPkgForm] = useState<{
    name: string;
    category: PhysioPackageConfig["category"];
    sessionsIncluded: number;
    price: number;
    validityDays: number;
    description: string;
  }>({
    name: "",
    category: "5-Session Rehab Pack",
    sessionsIncluded: 5,
    price: 220,
    validityDays: 60,
    description: "",
  });

  const handleSaveNewPackage = async () => {
    if (!pkgForm.name.trim()) {
      toast.error("Enter a package name.");
      return;
    }
    const newPkg: PhysioPackageConfig = {
      id: `physio-pkg-${Date.now()}`,
      name: pkgForm.name.trim(),
      category: pkgForm.category,
      sessionsIncluded: Math.max(1, Number(pkgForm.sessionsIncluded) || 5),
      price: Math.max(0, Number(pkgForm.price) || 200),
      validityDays: Math.max(1, Number(pkgForm.validityDays) || 60),
      description: pkgForm.description.trim() || undefined,
      active: true,
    };
    try {
      await savePackagesToBranch([...branchPackages, newPkg]);
      setPkgModalOpen(false);
      toast.success(`Created rehab package "${newPkg.name}"`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save rehab package.");
    }
  };

  // Analytics & Financial Reporting Computations
  const analytics = useMemo(() => {
    const activeCases = filteredPatients.filter(
      (p) => (p.caseStatus || "Active Treatment") !== "Discharged",
    ).length;
    const dischargedCases = filteredPatients.filter(
      (p) => p.caseStatus === "Discharged" || (p.medicalStatus === "Fit" && p.rtpStage === 5),
    ).length;

    const totalAppts = allAppointments.length;
    const completedAppts = allAppointments.filter((a) => a.status === "Completed");
    const noShowAppts = allAppointments.filter((a) => a.status === "No-Show");
    const cancelledAppts = allAppointments.filter((a) => a.status === "Cancelled");

    const completionRate =
      totalAppts > 0 ? Math.round((completedAppts.length / totalAppts) * 100) : 100;
    const noShowRate = totalAppts > 0 ? Math.round((noShowAppts.length / totalAppts) * 100) : 0;

    // Revenue & Payouts by Practitioner
    const byPractitioner = branchPractitioners.map((pract) => {
      const caseload = filteredPatients.filter(
        (p) => p.assignedPractitionerId === pract.id || p.therapistName === pract.name,
      ).length;

      const practAppts = allAppointments.filter(
        (a) =>
          (a.practitionerId === pract.id || a.practitionerName === pract.name) &&
          a.status === "Completed",
      );

      // Also include completed treatmentSessions logged directly on patients
      let revenue = 0;
      let payout = 0;
      let completedCount = 0;

      for (const pat of filteredPatients) {
        for (const sess of pat.treatmentSessions || []) {
          if (
            sess.status === "Completed" &&
            (sess.practitionerId === pract.id || sess.therapistName === pract.name)
          ) {
            completedCount += 1;
            revenue += sess.fee || 0;
            payout += sess.practitionerPayout ?? calculatePractitionerPayout(pract, sess.fee || 0);
          }
        }
      }

      if (completedCount === 0 && practAppts.length > 0) {
        completedCount = practAppts.length;
        revenue = practAppts.reduce((s, a) => s + (a.fee || 0), 0);
        payout = practAppts.reduce(
          (s, a) =>
            s + (a.practitionerPayoutAmount ?? calculatePractitionerPayout(pract, a.fee || 0)),
          0,
        );
      }

      return {
        practitioner: pract,
        caseload,
        completedCount,
        revenue,
        payout,
        netClinic: Math.max(0, revenue - payout),
      };
    });

    // Room Utilization Rate (based on daily 10 available slots per room)
    const byRoom = branchRooms.map((room) => {
      const bookingsInRoom = allAppointments.filter(
        (a) => a.roomId === room.id && a.status !== "Cancelled",
      );
      const todayInRoom = bookingsInRoom.filter((a) => a.date === scheduleDate);
      const utilizationPct = Math.min(100, Math.round((todayInRoom.length / 8) * 100));
      return {
        room,
        totalBookings: bookingsInRoom.length,
        todayBookings: todayInRoom.length,
        utilizationPct,
      };
    });

    const totalRevenue =
      byPractitioner.reduce((s, item) => s + item.revenue, 0) +
      filteredPatients.reduce((s, p) => s + (p.totalPaid || 0), 0);
    const totalPayouts = byPractitioner.reduce((s, item) => s + item.payout, 0);
    const totalPendingReceivables = filteredPatients.reduce((s, p) => s + (p.balanceDue || 0), 0);

    return {
      activeCases,
      dischargedCases,
      totalAppts,
      completedApptsCount: completedAppts.length,
      noShowCount: noShowAppts.length,
      cancelledCount: cancelledAppts.length,
      completionRate,
      noShowRate,
      byPractitioner,
      byRoom,
      totalRevenue,
      totalPayouts,
      totalPendingReceivables,
    };
  }, [filteredPatients, allAppointments, branchPractitioners, branchRooms, scheduleDate]);

  // Export CSV Summary Report
  const handleExportFinancialSummaryCsv = () => {
    const rows: string[][] = [
      [
        "Section",
        "Name / Identifier",
        "Branch",
        "Role / Status",
        "Caseload / Bookings",
        "Completed Sessions",
        "Gross Revenue",
        "Practitioner Payout",
        "Net Clinic Margin",
      ],
    ];

    for (const item of analytics.byPractitioner) {
      rows.push([
        "Practitioner",
        item.practitioner.name,
        item.practitioner.branch,
        `${item.practitioner.payoutModel} (${item.practitioner.commissionPct}%)`,
        String(item.caseload),
        String(item.completedCount),
        String(item.revenue),
        String(item.payout),
        String(item.netClinic),
      ]);
    }

    for (const r of analytics.byRoom) {
      rows.push([
        "Treatment Room",
        r.room.name,
        r.room.branch,
        r.room.status,
        String(r.totalBookings),
        `${r.utilizationPct}% Daily Util`,
        "-",
        "-",
        "-",
      ]);
    }

    for (const p of filteredPatients) {
      rows.push([
        "Patient Case",
        p.patientName,
        p.branch,
        `${p.caseStatus || "Active Treatment"} (${p.medicalStatus} - RTP ${p.rtpStage}/5)`,
        p.injuryArea,
        String((p.treatmentSessions || []).length),
        String(p.totalBilled || 0),
        "-",
        `Balance Due: ${p.balanceDue || 0}`,
      ]);
    }

    const csvContent = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vescio-nexus-physio-report-${activeBranchName.toLowerCase().replace(/\s+/g, "-")}-${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported Physiotherapy & Medical Center Financial Summary CSV");
  };

  // Filtered Patients List for Directory
  const directoryPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    return filteredPatients.filter((p) => {
      if (patientStatusFilter !== "All") {
        if (patientStatusFilter === "Discharged") {
          if (p.caseStatus !== "Discharged") return false;
        } else if (p.medicalStatus !== patientStatusFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        p.patientName.toLowerCase().includes(q) ||
        (p.diagnosis || "").toLowerCase().includes(q) ||
        (p.injuryArea || "").toLowerCase().includes(q) ||
        (p.therapistName || "").toLowerCase().includes(q) ||
        (p.phone || "").toLowerCase().includes(q)
      );
    });
  }, [filteredPatients, patientSearch, patientStatusFilter]);

  return (
    <div className="space-y-6">
      {/* TOP HEADER & BRANCH SWITCHER */}
      <Card className="p-5 bg-gradient-to-br from-rose-500/10 via-ink-900 to-ink-900 border-rose-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-white tracking-tight">
                  Physiotherapy &amp; Medical Center Module
                </h2>
                <Badge tone="red">{activeBranchName}</Badge>
                <Badge tone="green">
                  {activeBranchObj?.physioClinicStatus || "Open"} · {branchRooms.length} Rooms /
                  Cubicles
                </Badge>
              </div>
              <p className="text-xs text-ink-300 mt-0.5">
                Patient Intake &amp; SOAP Clinical Files · Practitioners &amp; Conflict-Free
                Treatment Rooms · Session Workflow · Rehab Packages &amp; Payout Analytics
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Branch Filter Pills */}
            <div className="flex items-center bg-black/30 border border-ink-800 rounded-xl p-1">
              <button
                type="button"
                onClick={() => onSelectBranch("All")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedBranch === "All"
                    ? "bg-rose-500 text-white shadow"
                    : "text-ink-400 hover:text-white"
                }`}
              >
                All Branches
              </button>
              {db.branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBranch(b.name)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedBranch === b.name
                      ? "bg-rose-500 text-white shadow"
                      : "text-ink-400 hover:text-white"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>

            <Btn variant="secondary" size="sm" onClick={() => openBookAppointmentModal()}>
              <Calendar className="w-3.5 h-3.5 text-sky-400" /> + Book Appointment
            </Btn>
            <Btn variant="secondary" size="sm" onClick={openNewPractitionerModal}>
              <Stethoscope className="w-3.5 h-3.5 text-emerald-400" /> + Practitioner
            </Btn>
            <Btn variant="primary" size="sm" onClick={openNewIntakeModal}>
              <Plus className="w-3.5 h-3.5" /> + Patient Intake
            </Btn>
          </div>
        </div>

        {/* 4 Summary Clinical & Financial KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-4 border-t border-ink-800">
          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              Active vs. Discharged Cases
            </div>
            <div className="text-xl font-black text-white mt-0.5">
              {analytics.activeCases} Active{" "}
              <span className="text-xs font-normal text-emerald-400">
                · {analytics.dischargedCases} Discharged
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              Practitioners &amp; Treatment Rooms
            </div>
            <div className="text-xl font-black text-sky-400 mt-0.5">
              {branchPractitioners.length} Clinicians{" "}
              <span className="text-xs font-normal text-ink-300">· {branchRooms.length} Rooms</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              Session Completion / No-Show Rate
            </div>
            <div className="text-xl font-black text-emerald-400 mt-0.5">
              {analytics.completionRate}% Completed{" "}
              <span className="text-xs font-normal text-rose-400">
                ({analytics.noShowRate}% No-Show)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              Clinic Revenue &amp; Accrued Payouts
            </div>
            <div className="text-xl font-black text-amber-400 mt-0.5">
              {money(analytics.totalRevenue)}{" "}
              <span className="text-xs font-normal text-ink-300">
                · Payouts: {money(analytics.totalPayouts)}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* SUB-NAVIGATION TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 pb-3">
        {[
          {
            id: "schedule" as PhysioSubTab,
            label: "Appointment Schedule & Workflow",
            icon: Calendar,
            badge: appointmentsForSelectedDate.length,
          },
          {
            id: "patients" as PhysioSubTab,
            label: "Patients & Clinical SOAP Files",
            icon: FileText,
            badge: filteredPatients.length,
          },
          {
            id: "practitioners_rooms" as PhysioSubTab,
            label: "Practitioners & Treatment Rooms",
            icon: Stethoscope,
            badge: `${branchPractitioners.length}/${branchRooms.length}`,
          },
          {
            id: "billing_packages" as PhysioSubTab,
            label: "Billing, Packages & Payouts",
            icon: DollarSign,
            badge: branchPackages.length,
          },
          {
            id: "analytics" as PhysioSubTab,
            label: "Analytics & Financial Reports",
            icon: BarChart3,
            badge: "CSV",
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                active
                  ? "bg-rose-500 text-white border-rose-400 shadow-md"
                  : "bg-ink-900 text-ink-300 border-ink-800 hover:text-white hover:border-rose-500/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                  active ? "bg-black/25 text-white" : "bg-white/5 text-ink-400"
                }`}
              >
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          SUB-TAB 1: APPOINTMENT SCHEDULING & SESSION WORKFLOW
      ===================================================================== */}
      {activeSubTab === "schedule" && (
        <div className="space-y-5">
          <Card className="p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-rose-400" />
                  Clinical Appointment Schedule &amp; Room Allocation Board
                </h3>
                <p className="text-xs text-ink-400">
                  Filterable by Practitioner and Treatment Room · Automatic double-booking
                  prevention across rooms &amp; clinicians
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Date Picker */}
                <div className="flex items-center gap-1 bg-black/30 border border-ink-800 rounded-xl p-1">
                  <button
                    type="button"
                    onClick={() => {
                      const prev = new Date(
                        new Date(scheduleDate + "T12:00:00").getTime() - 86400000,
                      )
                        .toISOString()
                        .slice(0, 10);
                      setScheduleDate(prev);
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 text-ink-400 hover:text-white cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="bg-transparent text-xs font-bold text-white px-2 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Date(
                        new Date(scheduleDate + "T12:00:00").getTime() + 86400000,
                      )
                        .toISOString()
                        .slice(0, 10);
                      setScheduleDate(next);
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 text-ink-400 hover:text-white cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <Btn variant="secondary" size="sm" onClick={() => setScheduleDate(todayStr)}>
                  Today
                </Btn>

                <Btn
                  variant="primary"
                  size="sm"
                  onClick={() => openBookAppointmentModal()}
                  disabled={Boolean(activeDateOffDay)}
                >
                  <Plus className="w-3.5 h-3.5" /> + Book Appointment
                </Btn>
              </div>
            </div>

            {/* Filter Bar by Practitioner, Room, Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3 pt-3 border-t border-ink-800">
              <Field label="Filter by Practitioner">
                <Select
                  value={filterPractitionerId}
                  onChange={(e) => setFilterPractitionerId(e.target.value)}
                >
                  <option value="All">All Practitioners ({branchPractitioners.length})</option>
                  {branchPractitioners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.specialty}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Filter by Treatment Room / Cubicle">
                <Select value={filterRoomId} onChange={(e) => setFilterRoomId(e.target.value)}>
                  <option value="All">All Treatment Rooms ({branchRooms.length})</option>
                  {branchRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.status})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Filter by Appointment Status">
                <Select
                  value={filterApptStatus}
                  onChange={(e) => setFilterApptStatus(e.target.value)}
                >
                  <option value="All">All Statuses</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Checked-In">Checked-In</option>
                  <option value="In-Treatment">In-Treatment</option>
                  <option value="Completed">Completed</option>
                  <option value="No-Show">No-Show</option>
                  <option value="Cancelled">Cancelled</option>
                </Select>
              </Field>
            </div>

            {activeDateOffDay && (
              <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
                <strong>Branch Closed on {scheduleDate}:</strong> {activeDateOffDay.reason} (Synced
                with Facility Off Days).
              </div>
            )}

            {/* Room Availability Strip for Selected Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2">
              {branchRooms.map((room) => {
                const roomAppts = allAppointments.filter(
                  (a) =>
                    a.date === scheduleDate && a.roomId === room.id && a.status !== "Cancelled",
                );
                return (
                  <div
                    key={room.id}
                    className="p-3 rounded-xl bg-black/30 border border-ink-800 flex flex-col justify-between gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white truncate">{room.name}</span>
                      <Badge tone={room.status === "Available" ? "green" : "red"}>
                        {room.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-ink-400">
                      {roomAppts.length} session(s) booked on {scheduleDate}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Appointments Timeline List */}
            {appointmentsForSelectedDate.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-ink-800 rounded-xl space-y-2">
                <Stethoscope className="w-8 h-8 text-ink-400 mx-auto opacity-60" />
                <div className="text-sm font-bold text-white">
                  No physiotherapy appointments matching filters on {scheduleDate}
                </div>
                <p className="text-xs text-ink-400 max-w-md mx-auto">
                  Register a patient via &ldquo;+ Patient Intake&rdquo; and book an Initial
                  Assessment or Follow-Up Treatment session assigned to a Practitioner and Room.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <Btn variant="secondary" size="sm" onClick={openNewIntakeModal}>
                    + New Patient Intake
                  </Btn>
                  <Btn variant="primary" size="sm" onClick={() => openBookAppointmentModal()}>
                    + Book Appointment
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {appointmentsForSelectedDate.map((appt) => (
                  <div
                    key={appt.id}
                    className="p-4 rounded-xl bg-black/35 border border-ink-800 hover:border-rose-500/40 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-rose-500/15 text-rose-300 font-mono text-xs font-black">
                          {appt.startTime} – {appt.endTime}
                        </span>
                        <span className="text-sm font-black text-white">{appt.patientName}</span>
                        <Badge tone="blue">{appt.appointmentType}</Badge>
                        <Badge
                          tone={
                            appt.status === "Completed"
                              ? "green"
                              : appt.status === "In-Treatment" || appt.status === "Checked-In"
                                ? "amber"
                                : appt.status === "No-Show" || appt.status === "Cancelled"
                                  ? "red"
                                  : "gray"
                          }
                        >
                          {appt.status}
                        </Badge>
                        <Badge
                          tone={
                            appt.paymentStatus === "Paid" ||
                            appt.paymentStatus === "Package Deducted" ||
                            appt.paymentStatus === "Insurance Covered"
                              ? "green"
                              : "amber"
                          }
                        >
                          {appt.paymentStatus} · {money(appt.fee)}
                        </Badge>
                      </div>

                      <div className="text-xs text-ink-300 flex flex-wrap items-center gap-3">
                        <span>
                          Practitioner:{" "}
                          <strong className="text-white">{appt.practitionerName}</strong>
                        </span>
                        <span>·</span>
                        <span>
                          Room/Cubicle: <strong className="text-sky-400">{appt.roomName}</strong>
                        </span>
                        <span>·</span>
                        <span>Modality: {appt.modality}</span>
                        {appt.invoiceNumber && (
                          <span className="font-mono text-[11px] text-ink-400">
                            ({appt.invoiceNumber})
                          </span>
                        )}
                      </div>

                      {appt.soapSubjective && (
                        <div className="text-[11px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 mt-1">
                          <strong>SOAP Charted (Pain {appt.painScore ?? 0}/10):</strong> S:{" "}
                          {appt.soapSubjective} · P: {appt.soapPlan}
                        </div>
                      )}
                    </div>

                    {/* Workflow Status Action Buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {appt.status === "Scheduled" && (
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => handleTransitionApptStatus(appt, "Checked-In")}
                        >
                          Check In
                        </Btn>
                      )}
                      {(appt.status === "Scheduled" || appt.status === "Checked-In") && (
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => handleTransitionApptStatus(appt, "In-Treatment")}
                        >
                          Start Treatment
                        </Btn>
                      )}
                      {appt.status !== "Completed" && appt.status !== "Cancelled" && (
                        <Btn
                          variant="primary"
                          size="xs"
                          onClick={() => handleTransitionApptStatus(appt, "Completed")}
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" /> Complete &amp; Chart SOAP
                        </Btn>
                      )}
                      {appt.status === "Scheduled" && (
                        <Btn
                          variant="ghost"
                          size="xs"
                          onClick={() => handleTransitionApptStatus(appt, "No-Show")}
                        >
                          No-Show
                        </Btn>
                      )}
                      <Btn
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setSelectedPatientFileId(appt.patientRecordId);
                          setActiveSubTab("patients");
                        }}
                      >
                        Patient File →
                      </Btn>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteAppointmentFromBranch(appt.branch, appt.id);
                            toast.success("Appointment removed.");
                          } catch (err: unknown) {
                            toast.error(
                              err instanceof Error ? err.message : "Failed to delete appointment.",
                            );
                          }
                        }}
                        className="p-1.5 rounded-lg text-ink-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        title="Delete Appointment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: PATIENT REGISTRATION & LONGITUDINAL CLINICAL SOAP FILES
      ===================================================================== */}
      {activeSubTab === "patients" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT 5 COLS: PATIENT ROSTER & INTAKE DIRECTORY */}
          <Card className="xl:col-span-5 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Patients &amp; Cases ({directoryPatients.length})
                </h3>
                <p className="text-[11px] text-ink-400">
                  Click any patient to inspect longitudinal SOAP history &amp; rehab prescriptions
                </p>
              </div>
              <Btn variant="primary" size="sm" onClick={openNewIntakeModal}>
                <Plus className="w-3.5 h-3.5" /> + Intake
              </Btn>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Search patient, injury, diagnosis..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-black/30 border border-ink-800 text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>
              <Select
                value={patientStatusFilter}
                onChange={(e) => setPatientStatusFilter(e.target.value)}
              >
                <option value="All">All Cases</option>
                <option value="Injured">Injured / Out</option>
                <option value="Limited">Limited Training</option>
                <option value="Fit">Cleared / Fit</option>
                <option value="Discharged">Discharged</option>
              </Select>
            </div>

            {directoryPatients.length === 0 ? (
              <div className="py-10 text-center text-xs text-ink-400 border border-dashed border-ink-800 rounded-xl">
                No patient records found. Click &ldquo;+ Intake&rdquo; to register a patient.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[650px] overflow-y-auto pr-1">
                {directoryPatients.map((pat) => {
                  const isSelected = activePatientFile?.id === pat.id;
                  return (
                    <div
                      key={pat.id}
                      onClick={() => setSelectedPatientFileId(pat.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-rose-500/15 border-rose-500/50 shadow"
                          : "bg-black/30 border-ink-800 hover:border-ink-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-white flex items-center gap-1.5">
                            <span>{pat.patientName}</span>
                            <Badge
                              tone={
                                pat.medicalStatus === "Fit"
                                  ? "green"
                                  : pat.medicalStatus === "Limited"
                                    ? "amber"
                                    : "red"
                              }
                            >
                              {pat.medicalStatus}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-ink-400">
                            {pat.patientType} · {pat.injuryArea} · RTP Stage {pat.rtpStage}/5
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditPatientModal(pat);
                          }}
                          className="p-1 text-ink-400 hover:text-white cursor-pointer"
                          title="Edit Patient Intake"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="text-xs text-ink-200 mt-1.5 font-medium">{pat.diagnosis}</div>

                      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-ink-800/70 text-[11px] text-ink-400">
                        <span>Clinician: {pat.therapistName}</span>
                        <span>
                          {(pat.treatmentSessions || []).length} session(s)
                          {pat.packageSessionsRemaining !== undefined
                            ? ` · ${pat.packageSessionsRemaining} pkg credits left`
                            : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* RIGHT 7 COLS: FULL LONGITUDINAL PATIENT FILE (DEMOGRAPHICS, CONTRAINDICATIONS, SOAP, EXERCISES) */}
          <Card className="xl:col-span-7 p-5 space-y-5">
            {!activePatientFile ? (
              <div className="py-16 text-center space-y-3">
                <FileText className="w-10 h-10 text-ink-400 mx-auto opacity-50" />
                <div className="text-sm font-bold text-white">
                  Select or Register a Patient to View Full Clinical File
                </div>
                <Btn variant="primary" size="sm" onClick={openNewIntakeModal}>
                  + Register New Patient Intake
                </Btn>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Patient File Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-ink-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black text-white">
                        {activePatientFile.patientName}
                      </h3>
                      <Badge tone="blue">{activePatientFile.patientType}</Badge>
                      <Badge
                        tone={activePatientFile.caseStatus === "Discharged" ? "green" : "amber"}
                      >
                        {activePatientFile.caseStatus || "Active Treatment"}
                      </Badge>
                    </div>
                    <div className="text-xs text-ink-400 mt-1">
                      Phone: {activePatientFile.phone || "—"} · Gender:{" "}
                      {activePatientFile.gender || "—"} · Age: {activePatientFile.age ?? "—"} ·
                      Intake: {activePatientFile.intakeDate} · Lead Clinician:{" "}
                      <strong className="text-white">{activePatientFile.therapistName}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(activePatientFile.balanceDue || 0) > 0 && (
                      <Btn
                        variant="primary"
                        size="sm"
                        onClick={() => handleCollectPatientBalanceDue(activePatientFile)}
                      >
                        <DollarSign className="w-3.5 h-3.5" /> Collect Balance Due (
                        {money(activePatientFile.balanceDue || 0)})
                      </Btn>
                    )}
                    <Btn
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditPatientModal(activePatientFile)}
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit File
                    </Btn>
                    <Btn
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAssignPkgPatient(activePatientFile);
                        setAssignPkgId(DEFAULT_PHYSIO_PACKAGES[2].id);
                        setAssignPkgPaidNow(true);
                      }}
                    >
                      <Package className="w-3.5 h-3.5 text-amber-400" /> Assign Package
                    </Btn>
                    <Btn
                      variant="primary"
                      size="sm"
                      onClick={() => openBookAppointmentModal(activePatientFile)}
                    >
                      <Calendar className="w-3.5 h-3.5" /> + Book Session
                    </Btn>
                  </div>
                </div>

                {/* Demographics, Emergency Contact, Allergies/Contraindications & Insurance Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-black/30 border border-ink-800 space-y-1.5">
                    <div className="text-[10px] font-black uppercase tracking-wider text-rose-400">
                      Medical History &amp; Contraindications
                    </div>
                    <div>
                      <span className="text-ink-400">Allergies / Contraindications: </span>
                      <strong className="text-amber-300">
                        {activePatientFile.allergiesContraindications || "None reported"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-ink-400">Medical / Surgical History: </span>
                      <span className="text-white">
                        {activePatientFile.medicalHistory || "Unremarkable"}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-400">Referring Doctor: </span>
                      <span className="text-white">
                        {activePatientFile.referringDoctor || "Self / Direct Academy Referral"}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-black/30 border border-ink-800 space-y-1.5">
                    <div className="text-[10px] font-black uppercase tracking-wider text-sky-400">
                      Emergency Contact &amp; Billing / Insurance
                    </div>
                    <div>
                      <span className="text-ink-400">Emergency Contact: </span>
                      <span className="text-white">
                        {activePatientFile.emergencyContactName
                          ? `${activePatientFile.emergencyContactName} (${activePatientFile.emergencyContactPhone})`
                          : "Not listed"}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-400">Billing / Coverage: </span>
                      <strong className="text-emerald-400">
                        {activePatientFile.billingType || "Self-Pay"}
                        {activePatientFile.insuranceProvider
                          ? ` · ${activePatientFile.insuranceProvider} (${activePatientFile.insuranceCoveragePct ?? 80}%)`
                          : ""}
                      </strong>
                    </div>
                    <div>
                      <span className="text-ink-400">Rehab Package Balance: </span>
                      <strong className="text-white">
                        {activePatientFile.packageSessionsRemaining !== undefined
                          ? `${activePatientFile.packageSessionsRemaining} / ${activePatientFile.packageSessionsTotal || activePatientFile.packageSessionsRemaining} sessions remaining (${activePatientFile.activePackageName || "Rehab Pack"})`
                          : "Single-Session Billing"}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Primary Diagnosis, Academy Medical Clearance & 5-Stage RTP Progression Bar */}
                <div className="p-4 rounded-xl bg-black/35 border border-ink-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-rose-300">
                        {activePatientFile.injuryArea} · {activePatientFile.severity}
                      </div>
                      <div className="text-sm font-black text-white">
                        Diagnosis: {activePatientFile.diagnosis}
                      </div>
                    </div>

                    {/* Live Academy Clearance & Recovery Switcher */}
                    <div className="flex items-center gap-2">
                      <Select
                        value={activePatientFile.medicalStatus}
                        onChange={async (e) => {
                          const nextStatus = e.target.value as PlayerMedicalClearanceStatus;
                          const nextRtp = nextStatus === "Fit" ? 5 : activePatientFile.rtpStage;
                          const updated: PhysioRecord = {
                            ...activePatientFile,
                            medicalStatus: nextStatus,
                            rtpStage: nextRtp,
                            updatedAt: new Date().toISOString(),
                          };
                          try {
                            await setEntity("physioRecords", updated);
                            await syncPlayerMedicalStatus(
                              updated.linkedPlayerId,
                              nextStatus,
                              updated.diagnosis,
                            );
                            toast.success(
                              `Updated medical clearance for ${updated.patientName} to ${nextStatus}`,
                            );
                          } catch (err: unknown) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Failed to update medical clearance.",
                            );
                          }
                        }}
                      >
                        <option value="Injured">Injured / Out</option>
                        <option value="Limited">Limited / Modified Training</option>
                        <option value="Fit">Fit (Cleared for Full Play)</option>
                      </Select>

                      <Select
                        value={activePatientFile.caseStatus || "Active Treatment"}
                        onChange={async (e) => {
                          const nextCase = e.target.value as PhysioRecord["caseStatus"];
                          try {
                            await setEntity("physioRecords", {
                              ...activePatientFile,
                              caseStatus: nextCase,
                              dischargeDate: nextCase === "Discharged" ? todayStr : undefined,
                              updatedAt: new Date().toISOString(),
                            });
                            toast.success(`Case status set to ${nextCase}`);
                          } catch (err: unknown) {
                            toast.error(
                              err instanceof Error ? err.message : "Failed to update case status.",
                            );
                          }
                        }}
                      >
                        <option value="Active Treatment">Active Treatment</option>
                        <option value="Maintenance / Rehab">Maintenance / Rehab</option>
                        <option value="Discharged">Discharged</option>
                        <option value="On Hold">On Hold</option>
                      </Select>
                    </div>
                  </div>

                  {/* Interactive 5-Stage RTP Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-ink-400 font-mono">
                        RETURN-TO-PLAY (RTP) PROGRESSION
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {RTP_STAGES[activePatientFile.rtpStage - 1]?.title}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {RTP_STAGES.map((st) => (
                        <button
                          key={st.stage}
                          type="button"
                          onClick={async () => {
                            const nextStage = st.stage as 1 | 2 | 3 | 4 | 5;
                            const nextMed =
                              nextStage === 5 ? "Fit" : activePatientFile.medicalStatus;
                            try {
                              await setEntity("physioRecords", {
                                ...activePatientFile,
                                rtpStage: nextStage,
                                medicalStatus: nextMed,
                                updatedAt: new Date().toISOString(),
                              });
                              await syncPlayerMedicalStatus(
                                activePatientFile.linkedPlayerId,
                                nextMed,
                                activePatientFile.diagnosis,
                              );
                            } catch (err: unknown) {
                              toast.error(
                                err instanceof Error ? err.message : "Failed to update RTP stage.",
                              );
                            }
                          }}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                            activePatientFile.rtpStage >= st.stage
                              ? st.stage === 5
                                ? "bg-emerald-500 text-black"
                                : "bg-rose-500 text-white"
                              : "bg-ink-850 text-ink-400 hover:text-white"
                          }`}
                        >
                          Stage {st.stage}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Rehab Exercise Prescriptions Section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-black uppercase tracking-wider text-ink-300 flex items-center gap-1.5">
                      <Dumbbell className="w-3.5 h-3.5 text-amber-400" />
                      Rehab Exercise Prescriptions (
                      {(activePatientFile.rehabExercises || []).length})
                    </div>
                    <Btn variant="secondary" size="xs" onClick={() => setExerciseModalOpen(true)}>
                      + Prescribe Exercise
                    </Btn>
                  </div>

                  {(activePatientFile.rehabExercises || []).length === 0 ? (
                    <div className="p-3.5 rounded-xl bg-black/20 border border-dashed border-ink-800 text-xs text-ink-400 text-center">
                      No rehab exercises prescribed yet. Click &ldquo;+ Prescribe Exercise&rdquo; to
                      build the patient&apos;s corrective loading protocol.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(activePatientFile.rehabExercises || []).map((ex) => (
                        <div
                          key={ex.id}
                          className="p-3 rounded-xl bg-black/30 border border-ink-800 space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-amber-300">{ex.exerciseName}</span>
                            <span className="text-[10px] text-ink-400">{ex.frequency}</span>
                          </div>
                          <div className="text-white font-mono text-[11px]">{ex.setsRepsTempo}</div>
                          {ex.targetGoal && (
                            <div className="text-[11px] text-ink-400">Goal: {ex.targetGoal}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Longitudinal Treatment History & Session-by-Session SOAP Notes */}
                <div className="space-y-2.5">
                  <div className="text-xs font-black uppercase tracking-wider text-ink-300">
                    Longitudinal Treatment History &amp; Session SOAP Notes (
                    {(activePatientFile.treatmentSessions || []).length})
                  </div>

                  {(activePatientFile.treatmentSessions || []).length === 0 ? (
                    <div className="p-6 rounded-xl bg-black/20 border border-dashed border-ink-800 text-xs text-ink-400 text-center">
                      No treatment sessions recorded yet for {activePatientFile.patientName}.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                      {(activePatientFile.treatmentSessions || []).map((sess) => (
                        <div
                          key={sess.id}
                          className="p-3.5 rounded-xl bg-black/30 border border-ink-800 space-y-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-rose-300">
                                {sess.date} {sess.time}
                              </span>
                              <Badge tone="blue">{sess.sessionType || sess.modality}</Badge>
                              <Badge
                                tone={
                                  sess.status === "Completed"
                                    ? "green"
                                    : sess.status === "Cancelled" || sess.status === "No-Show"
                                      ? "red"
                                      : "amber"
                                }
                              >
                                {sess.status}
                              </Badge>
                              <Badge tone="gray">Pain {sess.painScore}/10</Badge>
                            </div>
                            <span className="text-[11px] text-ink-400">
                              {sess.therapistName} {sess.roomName ? `· ${sess.roomName}` : ""} ·{" "}
                              <strong className="text-emerald-400">
                                {money(sess.fee)} ({sess.paymentStatus})
                              </strong>
                            </span>
                          </div>

                          {sess.soapSubjective || sess.soapObjective ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                              <div className="p-2 rounded bg-black/25 border border-ink-800/80">
                                <strong className="text-sky-400">S (Subjective):</strong>{" "}
                                {sess.soapSubjective || "—"}
                              </div>
                              <div className="p-2 rounded bg-black/25 border border-ink-800/80">
                                <strong className="text-emerald-400">O (Objective):</strong>{" "}
                                {sess.soapObjective || "—"}
                              </div>
                              <div className="p-2 rounded bg-black/25 border border-ink-800/80">
                                <strong className="text-amber-400">A (Assessment):</strong>{" "}
                                {sess.soapAssessment || "—"}
                              </div>
                              <div className="p-2 rounded bg-black/25 border border-ink-800/80">
                                <strong className="text-rose-400">P (Plan):</strong>{" "}
                                {sess.soapPlan || "—"}
                              </div>
                            </div>
                          ) : (
                            <div className="text-ink-300">{sess.soapNotes}</div>
                          )}

                          {sess.exercisePrescription && (
                            <div className="text-[11px] text-amber-300">
                              <strong>Prescribed Exercises:</strong> {sess.exercisePrescription}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: PRACTITIONERS & TREATMENT ROOMS / CUBICLES
      ===================================================================== */}
      {activeSubTab === "practitioners_rooms" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT 7 COLS: PRACTITIONERS DIRECTORY */}
          <Card className="xl:col-span-7 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Physiotherapists &amp; Medical Practitioners ({branchPractitioners.length})
                </h3>
                <p className="text-xs text-ink-400">
                  Specialties, working hours, commission/payout rates &amp; assigned patient
                  caseloads
                </p>
              </div>
              <Btn variant="primary" size="sm" onClick={openNewPractitionerModal}>
                <Plus className="w-3.5 h-3.5" /> + Add Practitioner
              </Btn>
            </div>

            <div className="space-y-3">
              {analytics.byPractitioner.map(
                ({ practitioner, caseload, completedCount, revenue, payout }) => (
                  <div
                    key={practitioner.id}
                    className="p-4 rounded-xl bg-black/30 border border-ink-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-black text-white">{practitioner.name}</h4>
                          <Badge tone={practitioner.status === "Active" ? "green" : "amber"}>
                            {practitioner.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-rose-300 font-medium">
                          {practitioner.title} · {practitioner.specialty}
                        </div>
                        <div className="text-[11px] text-ink-400 mt-0.5">
                          Hours: {practitioner.workingHoursStart}–{practitioner.workingHoursEnd} (
                          {practitioner.workingDays.join(", ")}) · Phone: {practitioner.phone}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditPractitionerModal(practitioner)}
                          className="p-1.5 rounded-lg text-ink-400 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await savePractitionersToBranch(
                                practitioner.branch,
                                branchPractitioners.filter((p) => p.id !== practitioner.id),
                              );
                              toast.success(`Removed ${practitioner.name}`);
                            } catch (err: unknown) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to remove practitioner.",
                              );
                            }
                          }}
                          className="p-1.5 rounded-lg text-ink-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-ink-800/70 text-xs">
                      <div>
                        <span className="text-[10px] text-ink-400 block">Assigned Caseload</span>
                        <span className="font-bold text-white">{caseload} Patients</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block">Payout Rate</span>
                        <span className="font-bold text-sky-400">
                          {practitioner.payoutModel === "Fixed Per Session"
                            ? `${money(practitioner.fixedPayoutPerSession || 25)} / session`
                            : `${practitioner.commissionPct}% Commission`}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block">Completed / Revenue</span>
                        <span className="font-bold text-emerald-400">
                          {completedCount} sess · {money(revenue)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block">Accrued Payout</span>
                        <span className="font-bold text-amber-400">{money(payout)}</span>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </Card>

          {/* RIGHT 5 COLS: TREATMENT ROOMS & CUBICLES */}
          <Card className="xl:col-span-5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Treatment Rooms &amp; Cubicles ({branchRooms.length})
                </h3>
                <p className="text-xs text-ink-400">
                  Protected against double-booking across overlapping time slots
                </p>
              </div>
              <Btn variant="primary" size="sm" onClick={openNewRoomModal}>
                <Plus className="w-3.5 h-3.5" /> + Add Room
              </Btn>
            </div>

            <div className="space-y-3">
              {analytics.byRoom.map(({ room, totalBookings, todayBookings, utilizationPct }) => (
                <div
                  key={room.id}
                  className="p-4 rounded-xl bg-black/30 border border-ink-800 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <DoorOpen className="w-4 h-4 text-sky-400" />
                        <h4 className="text-sm font-black text-white">{room.name}</h4>
                        <Badge tone={room.status === "Available" ? "green" : "red"}>
                          {room.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-ink-400 mt-0.5">
                        {room.roomType} · {room.branch}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditRoomModal(room)}
                        className="p-1.5 rounded-lg text-ink-400 hover:text-white hover:bg-white/10 cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await saveRoomsToBranch(
                              room.branch,
                              branchRooms.filter((r) => r.id !== room.id),
                            );
                            toast.success(`Removed ${room.name}`);
                          } catch (err: unknown) {
                            toast.error(
                              err instanceof Error ? err.message : "Failed to remove room.",
                            );
                          }
                        }}
                        className="p-1.5 rounded-lg text-ink-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-ink-300">
                    <span className="text-ink-400">Equipment:</span> {room.equipment}
                  </div>

                  <div className="pt-2 border-t border-ink-800/70 flex items-center justify-between text-[11px] text-ink-400">
                    <span>
                      Today ({scheduleDate}):{" "}
                      <strong className="text-white">{todayBookings} sessions</strong>
                    </span>
                    <span>
                      Utilization: <strong className="text-sky-400">{utilizationPct}%</strong> (
                      {totalBookings} total)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 4: BILLING, MULTI-SESSION REHAB PACKAGES & PRACTITIONER PAYOUTS
      ===================================================================== */}
      {activeSubTab === "billing_packages" && (
        <div className="space-y-6">
          {/* Rehab Packages Catalog */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Single-Session Rates &amp; Multi-Session Rehab Packages ({branchPackages.length})
                </h3>
                <p className="text-xs text-ink-400">
                  Assign rehab packages to patients for automatic session deduction upon treatment
                  completion
                </p>
              </div>
              <Btn variant="primary" size="sm" onClick={() => setPkgModalOpen(true)}>
                <Plus className="w-3.5 h-3.5" /> + Create Rehab Package
              </Btn>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {branchPackages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="p-4 rounded-xl bg-black/30 border border-ink-800 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <Badge tone="blue">{pkg.category}</Badge>
                      <span className="text-lg font-black text-emerald-400">
                        {money(pkg.price)}
                      </span>
                    </div>
                    <h4 className="text-sm font-black text-white mt-2">{pkg.name}</h4>
                    {pkg.description && (
                      <p className="text-xs text-ink-400 mt-1">{pkg.description}</p>
                    )}
                  </div>
                  <div className="pt-2 border-t border-ink-800 flex items-center justify-between text-xs">
                    <span className="text-ink-300">
                      <strong>{pkg.sessionsIncluded}</strong> Session(s) · {pkg.validityDays}d valid
                    </span>
                    <Btn
                      variant="secondary"
                      size="xs"
                      onClick={() => {
                        if (filteredPatients.length === 0) {
                          toast.info("Register a patient first to assign a package.");
                          return;
                        }
                        setAssignPkgPatient(filteredPatients[0]);
                        setAssignPkgId(pkg.id);
                        setAssignPkgPaidNow(true);
                      }}
                    >
                      Assign to Patient
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Practitioner Payout Calculations Table */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Practitioner Commission &amp; Payout Calculations
                </h3>
                <p className="text-xs text-ink-400">
                  Automated payout calculation based on completed clinical treatment sessions
                </p>
              </div>
              <Btn variant="secondary" size="sm" onClick={handleExportFinancialSummaryCsv}>
                <Download className="w-3.5 h-3.5" /> Export Payout Summary CSV
              </Btn>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-ink-800 text-[10px] font-black uppercase tracking-wider text-ink-400">
                    <th className="py-2.5 px-3">Practitioner</th>
                    <th className="py-2.5 px-3">Payout Model</th>
                    <th className="py-2.5 px-3">Active Caseload</th>
                    <th className="py-2.5 px-3">Completed Sessions</th>
                    <th className="py-2.5 px-3">Gross Session Revenue</th>
                    <th className="py-2.5 px-3">Practitioner Payout</th>
                    <th className="py-2.5 px-3">Net Clinic Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/60">
                  {analytics.byPractitioner.map((row) => (
                    <tr key={row.practitioner.id}>
                      <td className="py-3 px-3 font-bold text-white">
                        {row.practitioner.name}
                        <div className="text-[10px] text-ink-400 font-normal">
                          {row.practitioner.specialty}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-ink-300">
                        {row.practitioner.payoutModel === "Fixed Per Session"
                          ? `Fixed ${money(row.practitioner.fixedPayoutPerSession || 25)} / session`
                          : `${row.practitioner.commissionPct}% Commission`}
                      </td>
                      <td className="py-3 px-3 font-mono text-white">{row.caseload}</td>
                      <td className="py-3 px-3 font-mono text-white">{row.completedCount}</td>
                      <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                        {money(row.revenue)}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-amber-400">
                        {money(row.payout)}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-sky-400">
                        {money(row.netClinic)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 5: ANALYTICS & EXPORTABLE FINANCIAL REPORTS
      ===================================================================== */}
      {activeSubTab === "analytics" && (
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Physiotherapy &amp; Medical Center Analytics Dashboard
                </h3>
                <p className="text-xs text-ink-400">
                  Revenue by practitioner, room utilization rate, active vs. discharged patients
                  &amp; session completion metrics
                </p>
              </div>
              <Btn variant="primary" size="sm" onClick={handleExportFinancialSummaryCsv}>
                <Download className="w-3.5 h-3.5" /> Export Financial &amp; Clinical Report (CSV)
              </Btn>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Revenue by Practitioner */}
              <div className="p-4 rounded-xl bg-black/30 border border-ink-800 space-y-3">
                <div className="text-xs font-black uppercase tracking-wider text-emerald-400">
                  Revenue by Practitioner
                </div>
                {analytics.byPractitioner.map((item) => (
                  <div
                    key={item.practitioner.id}
                    className="flex items-center justify-between text-xs border-b border-ink-800/60 pb-2"
                  >
                    <div>
                      <div className="font-bold text-white">{item.practitioner.name}</div>
                      <div className="text-[10px] text-ink-400">
                        {item.completedCount} completed · Payout: {money(item.payout)}
                      </div>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">
                      {money(item.revenue)}
                    </span>
                  </div>
                ))}
              </div>

              {/* 2. Room Utilization Rate */}
              <div className="p-4 rounded-xl bg-black/30 border border-ink-800 space-y-3">
                <div className="text-xs font-black uppercase tracking-wider text-sky-400">
                  Room / Cubicle Utilization Rate
                </div>
                {analytics.byRoom.map((r) => (
                  <div key={r.room.id} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-white font-semibold truncate">{r.room.name}</span>
                      <span className="font-mono text-sky-400 font-bold">
                        {r.utilizationPct}% ({r.totalBookings} sessions)
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-sky-400"
                        style={{ width: `${Math.max(8, r.utilizationPct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* 3. Active vs Discharged & Completion / No-Show Rates */}
              <div className="p-4 rounded-xl bg-black/30 border border-ink-800 space-y-3 text-xs">
                <div className="text-xs font-black uppercase tracking-wider text-rose-400">
                  Outcomes &amp; Attendance Rates
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-ink-800/60">
                  <span className="text-ink-300">Active Rehab Patients</span>
                  <strong className="text-white font-mono">{analytics.activeCases}</strong>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-ink-800/60">
                  <span className="text-ink-300">Discharged / Cleared Patients</span>
                  <strong className="text-emerald-400 font-mono">
                    {analytics.dischargedCases}
                  </strong>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-ink-800/60">
                  <span className="text-ink-300">Session Completion Rate</span>
                  <strong className="text-emerald-400 font-mono">
                    {analytics.completionRate}% ({analytics.completedApptsCount} completed)
                  </strong>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-ink-800/60">
                  <span className="text-ink-300">No-Show / Cancelled</span>
                  <strong className="text-rose-400 font-mono">
                    {analytics.noShowCount} No-Show · {analytics.cancelledCount} Cancelled
                  </strong>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-ink-300">Pending Patient Receivables</span>
                  <strong className="text-amber-400 font-mono">
                    {money(analytics.totalPendingReceivables)}
                  </strong>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: COMPREHENSIVE PATIENT INTAKE & CLINICAL PROFILE
      ===================================================================== */}
      <Modal
        open={intakeModalOpen}
        onClose={() => setIntakeModalOpen(false)}
        title={
          editingPatientId
            ? "Edit Patient Clinical File"
            : "Comprehensive Patient Intake & Clinical Assessment"
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* 1. Personal Demographics */}
          <div className="p-3.5 rounded-xl bg-black/25 border border-ink-800 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-rose-400">
              1. Personal Demographics &amp; Emergency Contact
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
              <Field label="Patient Category">
                <Select
                  value={intakeForm.patientType}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      patientType: e.target.value as "Academy Player" | "External Patient",
                    }))
                  }
                >
                  <option value="External Patient">External Clinic Patient</option>
                  <option value="Academy Player">Academy Player (Synced Roster)</option>
                </Select>
              </Field>

              {intakeForm.patientType === "Academy Player" && (
                <Field label="Select Academy Player">
                  <Select
                    value={intakeForm.linkedPlayerId}
                    onChange={(e) => {
                      const p = db.players.find((pl) => pl.id === e.target.value);
                      setIntakeForm((f) => ({
                        ...f,
                        linkedPlayerId: e.target.value,
                        patientName: p ? p.name : f.patientName,
                        team: p?.team || f.team,
                        phone: p?.phone || p?.parentPhone || f.phone,
                        branch: p?.branch || f.branch,
                        emergencyContactName: p?.parentName || f.emergencyContactName,
                        emergencyContactPhone: p?.parentPhone || f.emergencyContactPhone,
                      }));
                    }}
                  >
                    <option value="">Choose Player...</option>
                    {db.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.team})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label="Patient Full Name">
                <Input
                  value={intakeForm.patientName}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, patientName: e.target.value }))}
                  placeholder="Full Legal Name"
                />
              </Field>

              <Field label="Phone Number">
                <Input
                  value={intakeForm.phone}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+961 70 000 000"
                />
              </Field>

              <Field label="Age">
                <Input
                  type="number"
                  value={intakeForm.age}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, age: e.target.value }))}
                  placeholder="22"
                />
              </Field>

              <Field label="Gender">
                <Select
                  value={intakeForm.gender}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      gender: e.target.value as "Male" | "Female" | "Other",
                    }))
                  }
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </Select>
              </Field>

              <Field label="Emergency Contact Name">
                <Input
                  value={intakeForm.emergencyContactName}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      emergencyContactName: e.target.value,
                    }))
                  }
                  placeholder="Parent / Spouse Name"
                />
              </Field>

              <Field label="Emergency Contact Phone">
                <Input
                  value={intakeForm.emergencyContactPhone}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      emergencyContactPhone: e.target.value,
                    }))
                  }
                  placeholder="+961 ..."
                />
              </Field>

              <Field label="Branch">
                <Select
                  value={intakeForm.branch}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, branch: e.target.value }))}
                >
                  {db.branches.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {/* 2. Medical History, Contraindications & Referring Doctor */}
          <div className="p-3.5 rounded-xl bg-black/25 border border-ink-800 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-400">
              2. Medical History, Allergies / Contraindications &amp; Referral
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
              <Field label="Medical & Surgical History">
                <Input
                  value={intakeForm.medicalHistory}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, medicalHistory: e.target.value }))}
                  placeholder="Prior surgeries, chronic conditions..."
                />
              </Field>
              <Field label="Allergies & Clinical Contraindications">
                <Input
                  value={intakeForm.allergiesContraindications}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      allergiesContraindications: e.target.value,
                    }))
                  }
                  placeholder="Pacemaker, latex allergy, DVT, needle contraindications..."
                />
              </Field>
              <Field label="Referring Doctor / Surgeon">
                <Input
                  value={intakeForm.referringDoctor}
                  onChange={(e) =>
                    setIntakeForm((f) => ({ ...f, referringDoctor: e.target.value }))
                  }
                  placeholder="Dr. Antoine Frem (Orthopedics)"
                />
              </Field>
              <Field label="Current Medications">
                <Input
                  value={intakeForm.currentMedications}
                  onChange={(e) =>
                    setIntakeForm((f) => ({ ...f, currentMedications: e.target.value }))
                  }
                  placeholder="NSAIDs, Analgesics..."
                />
              </Field>
            </div>
          </div>

          {/* 3. Primary Complaint, Diagnosis & Clinical Clearance */}
          <div className="p-3.5 rounded-xl bg-black/25 border border-ink-800 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-sky-400">
              3. Primary Complaint, Injury Area &amp; Clinical Diagnosis
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
              <Field label="Anatomical Injury Area">
                <Select
                  value={intakeForm.injuryArea}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      injuryArea: e.target.value as PhysioRecord["injuryArea"],
                    }))
                  }
                >
                  <option value="Knee / ACL / Meniscus">Knee / ACL / Meniscus</option>
                  <option value="Ankle / Foot">Ankle / Foot</option>
                  <option value="Hamstring / Groin">Hamstring / Groin</option>
                  <option value="Shoulder / Rotator Cuff">Shoulder / Rotator Cuff</option>
                  <option value="Lumbar / Lower Back">Lumbar / Lower Back</option>
                  <option value="Wrist / Hand">Wrist / Hand</option>
                  <option value="Concussion / General">Concussion / General</option>
                </Select>
              </Field>

              <Field label="Severity Grade">
                <Select
                  value={intakeForm.severity}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      severity: e.target.value as PhysioRecord["severity"],
                    }))
                  }
                >
                  <option value="Mild (Grade 1)">Mild (Grade 1)</option>
                  <option value="Moderate (Grade 2)">Moderate (Grade 2)</option>
                  <option value="Severe (Grade 3)">Severe (Grade 3)</option>
                </Select>
              </Field>

              <Field label="Assigned Lead Practitioner">
                <Select
                  value={intakeForm.assignedPractitionerId}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      assignedPractitionerId: e.target.value,
                    }))
                  }
                >
                  {branchPractitioners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
              <Field label="Primary Complaint & Clinical Diagnosis">
                <Input
                  value={intakeForm.diagnosis}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  placeholder="e.g., Grade 2 Lateral Ankle Sprain (ATFL)"
                />
              </Field>
              <Field label="Activity & Training Restrictions">
                <Input
                  value={intakeForm.restrictions}
                  onChange={(e) => setIntakeForm((f) => ({ ...f, restrictions: e.target.value }))}
                  placeholder="No cutting/pivoting; linear running only"
                />
              </Field>
            </div>
          </div>

          {/* 4. Insurance & Billing Setup */}
          <div className="p-3.5 rounded-xl bg-black/25 border border-ink-800 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-emerald-400">
              4. Insurance, Rehab Package &amp; Billing Setup
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
              <Field label="Billing Model">
                <Select
                  value={intakeForm.billingType}
                  onChange={(e) =>
                    setIntakeForm((f) => ({
                      ...f,
                      billingType: e.target.value as typeof intakeForm.billingType,
                    }))
                  }
                >
                  <option value="Self-Pay">Single-Session Self-Pay</option>
                  <option value="Rehab Package">Multi-Session Rehab Package</option>
                  <option value="Insurance">Medical Insurance Coverage</option>
                  <option value="Academy Covered">Academy Covered</option>
                </Select>
              </Field>

              {intakeForm.billingType === "Rehab Package" && (
                <Field label="Assign Rehab Package">
                  <Select
                    value={intakeForm.packageId}
                    onChange={(e) => setIntakeForm((f) => ({ ...f, packageId: e.target.value }))}
                  >
                    <option value="">Select Rehab Package...</option>
                    {branchPackages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} ({pkg.sessionsIncluded} sessions — {money(pkg.price)})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {intakeForm.billingType === "Insurance" && (
                <>
                  <Field label="Insurance Provider">
                    <Input
                      value={intakeForm.insuranceProvider}
                      onChange={(e) =>
                        setIntakeForm((f) => ({
                          ...f,
                          insuranceProvider: e.target.value,
                        }))
                      }
                      placeholder="e.g., MedGulf / Allianz / Bankers"
                    />
                  </Field>
                  <Field label="Policy #">
                    <Input
                      value={intakeForm.insurancePolicyNumber}
                      onChange={(e) =>
                        setIntakeForm((f) => ({
                          ...f,
                          insurancePolicyNumber: e.target.value,
                        }))
                      }
                      placeholder="POL-99412"
                    />
                  </Field>
                </>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setIntakeModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSavePatientIntake}>
              {editingPatientId ? "Update Clinical File" : "Complete Patient Intake"}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 2: BOOK CLINICAL APPOINTMENT (WITH DOUBLE-BOOKING GUARD)
      ===================================================================== */}
      <Modal
        open={apptModalOpen}
        onClose={() => setApptModalOpen(false)}
        title="Book Physiotherapy Appointment (Room & Practitioner Protected)"
      >
        <div className="space-y-4">
          {liveBookingConflict && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{liveBookingConflict}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
            <Field label="Patient">
              <Select
                value={apptForm.patientRecordId}
                onChange={(e) => setApptForm((f) => ({ ...f, patientRecordId: e.target.value }))}
              >
                <option value="">Select Patient...</option>
                {filteredPatients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientName} ({p.injuryArea})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Appointment Type">
              <Select
                value={apptForm.appointmentType}
                onChange={(e) =>
                  setApptForm((f) => ({
                    ...f,
                    appointmentType: e.target.value as PhysioAppointment["appointmentType"],
                  }))
                }
              >
                <option value="Initial Assessment">Initial Assessment</option>
                <option value="Follow-Up Treatment">Follow-Up Treatment</option>
                <option value="Rehab Load Session">Rehab Load Session</option>
                <option value="RTP Clearance Test">RTP Clearance Test</option>
              </Select>
            </Field>

            <Field label="Practitioner">
              <Select
                value={apptForm.practitionerId}
                onChange={(e) => {
                  const pr = branchPractitioners.find((p) => p.id === e.target.value);
                  setApptForm((f) => ({
                    ...f,
                    practitionerId: e.target.value,
                    fee: pr ? pr.defaultSessionFee : f.fee,
                  }));
                }}
              >
                {branchPractitioners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.workingHoursStart}–{p.workingHoursEnd})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Treatment Room / Cubicle">
              <Select
                value={apptForm.roomId}
                onChange={(e) => setApptForm((f) => ({ ...f, roomId: e.target.value }))}
              >
                {branchRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} [{r.status}]
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date">
              <Input
                type="date"
                value={apptForm.date}
                onChange={(e) => setApptForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>

            <div className="grid grid-cols-2 items-end gap-2">
              <Field label="Start Time">
                <Input
                  type="time"
                  value={apptForm.startTime}
                  onChange={(e) => setApptForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </Field>
              <Field label="End Time">
                <Input
                  type="time"
                  value={apptForm.endTime}
                  onChange={(e) => setApptForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Primary Modality">
              <Select
                value={apptForm.modality}
                onChange={(e) => setApptForm((f) => ({ ...f, modality: e.target.value }))}
              >
                <option value="Manual Therapy & Mobilization">
                  Manual Therapy &amp; Mobilization
                </option>
                <option value="Dry Needling / Electrotherapy">Dry Needling / Electrotherapy</option>
                <option value="Cryotherapy & Compression">Cryotherapy &amp; Compression</option>
                <option value="Rehab Gym Load Protocol">Rehab Gym Load Protocol</option>
                <option value="Return-to-Play Biomechanical Test">
                  Return-to-Play Biomechanical Test
                </option>
              </Select>
            </Field>

            <Field label="Session Fee">
              <Input
                type="number"
                value={apptForm.fee}
                onChange={(e) => setApptForm((f) => ({ ...f, fee: Number(e.target.value) }))}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setApptModalOpen(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSaveAppointment}
              disabled={Boolean(liveBookingConflict)}
            >
              Confirm Appointment
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 3: COMPLETE SESSION, CHART SOAP NOTES & SETTLE BILLING
      ===================================================================== */}
      <Modal
        open={Boolean(completingAppt)}
        onClose={() => setCompletingAppt(null)}
        title={`Complete Session & Chart SOAP — ${completingAppt?.patientName || ""}`}
      >
        {completingAppt && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
              <Field label="S — Subjective (Patient Reported)">
                <Textarea
                  rows={2}
                  value={soapCompletionForm.soapSubjective}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      soapSubjective: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="O — Objective (ROM, Strength, Tests)">
                <Textarea
                  rows={2}
                  value={soapCompletionForm.soapObjective}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      soapObjective: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="A — Assessment (Clinical Response)">
                <Textarea
                  rows={2}
                  value={soapCompletionForm.soapAssessment}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      soapAssessment: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="P — Plan (Next Session & Loading)">
                <Textarea
                  rows={2}
                  value={soapCompletionForm.soapPlan}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      soapPlan: e.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
              <Field label="Pain Score (0–10 VAS)">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={soapCompletionForm.painScore}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      painScore: Number(e.target.value),
                    }))
                  }
                />
              </Field>

              <Field label="Billing Settlement">
                <Select
                  value={soapCompletionForm.paymentStatus}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      paymentStatus: e.target.value as PhysioAppointment["paymentStatus"],
                    }))
                  }
                >
                  <option value="Paid">Paid (Post to Ledger)</option>
                  <option value="Package Deducted">Deduct from Rehab Package</option>
                  <option value="Insurance Covered">Insurance Covered</option>
                  <option value="Academy Covered">Academy Covered</option>
                  <option value="Pending">Pending / Invoice Receivable</option>
                </Select>
              </Field>

              <Field label="Update RTP Stage">
                <Select
                  value={String(soapCompletionForm.nextRtpStage)}
                  onChange={(e) =>
                    setSoapCompletionForm((f) => ({
                      ...f,
                      nextRtpStage: Number(e.target.value) as 1 | 2 | 3 | 4 | 5,
                    }))
                  }
                >
                  {[1, 2, 3, 4, 5].map((st) => (
                    <option key={st} value={st}>
                      Stage {st} / 5
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Rehab Exercise Prescription Updates">
              <Input
                value={soapCompletionForm.exercisePrescription}
                onChange={(e) =>
                  setSoapCompletionForm((f) => ({
                    ...f,
                    exercisePrescription: e.target.value,
                  }))
                }
              />
            </Field>

            <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
              <Btn variant="secondary" onClick={() => setCompletingAppt(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={handleConfirmCompleteSessionWithSoap}>
                Save SOAP &amp; Finalize Session Billing
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* =====================================================================
          MODAL 4: ADD / EDIT PRACTITIONER
      ===================================================================== */}
      <Modal
        open={practitionerModalOpen}
        onClose={() => setPractitionerModalOpen(false)}
        title={editingPractitionerId ? "Edit Practitioner" : "Add Physiotherapist / Doctor"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
            <Field label="Practitioner Name">
              <Input
                value={practitionerForm.name}
                onChange={(e) => setPractitionerForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Dr. Rami Khoury (DPT)"
              />
            </Field>
            <Field label="Clinical Title">
              <Input
                value={practitionerForm.title}
                onChange={(e) => setPractitionerForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
            <Field label="Specialty">
              <Input
                value={practitionerForm.specialty}
                onChange={(e) => setPractitionerForm((f) => ({ ...f, specialty: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={practitionerForm.phone}
                onChange={(e) => setPractitionerForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="Working Hours Start">
              <Input
                type="time"
                value={practitionerForm.workingHoursStart}
                onChange={(e) =>
                  setPractitionerForm((f) => ({
                    ...f,
                    workingHoursStart: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Working Hours End">
              <Input
                type="time"
                value={practitionerForm.workingHoursEnd}
                onChange={(e) =>
                  setPractitionerForm((f) => ({
                    ...f,
                    workingHoursEnd: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Default Session Rate">
              <Input
                type="number"
                value={practitionerForm.defaultSessionFee}
                onChange={(e) =>
                  setPractitionerForm((f) => ({
                    ...f,
                    defaultSessionFee: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Payout Model">
              <Select
                value={practitionerForm.payoutModel}
                onChange={(e) =>
                  setPractitionerForm((f) => ({
                    ...f,
                    payoutModel: e.target.value as "Percentage Commission" | "Fixed Per Session",
                  }))
                }
              >
                <option value="Percentage Commission">Percentage Commission (%)</option>
                <option value="Fixed Per Session">Fixed Payout Per Session</option>
              </Select>
            </Field>
            {practitionerForm.payoutModel === "Percentage Commission" ? (
              <Field label="Commission Rate (%)">
                <Input
                  type="number"
                  value={practitionerForm.commissionPct}
                  onChange={(e) =>
                    setPractitionerForm((f) => ({
                      ...f,
                      commissionPct: Number(e.target.value),
                    }))
                  }
                />
              </Field>
            ) : (
              <Field label="Fixed Payout Per Session">
                <Input
                  type="number"
                  value={practitionerForm.fixedPayoutPerSession}
                  onChange={(e) =>
                    setPractitionerForm((f) => ({
                      ...f,
                      fixedPayoutPerSession: Number(e.target.value),
                    }))
                  }
                />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setPractitionerModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSavePractitioner}>
              Save Practitioner
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 5: ADD / EDIT TREATMENT ROOM OR CUBICLE
      ===================================================================== */}
      <Modal
        open={roomModalOpen}
        onClose={() => setRoomModalOpen(false)}
        title={editingRoomId ? "Edit Treatment Room / Cubicle" : "Add Treatment Room / Cubicle"}
      >
        <div className="space-y-4">
          <Field label="Room / Cubicle Name">
            <Input
              value={roomForm.name}
              onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
            <Field label="Room Type">
              <Select
                value={roomForm.roomType}
                onChange={(e) =>
                  setRoomForm((f) => ({
                    ...f,
                    roomType: e.target.value as PhysioRoom["roomType"],
                  }))
                }
              >
                <option value="Private Assessment Room">Private Assessment Room</option>
                <option value="Manual Therapy Cubicle">Manual Therapy Cubicle</option>
                <option value="Electrotherapy & Modalities Bay">
                  Electrotherapy &amp; Modalities Bay
                </option>
                <option value="Rehab & Biomechanics Zone">Rehab &amp; Biomechanics Zone</option>
              </Select>
            </Field>
            <Field label="Operational Status">
              <Select
                value={roomForm.status}
                onChange={(e) =>
                  setRoomForm((f) => ({
                    ...f,
                    status: e.target.value as "Available" | "Maintenance",
                  }))
                }
              >
                <option value="Available">Available</option>
                <option value="Maintenance">Maintenance (Blocks Booking)</option>
              </Select>
            </Field>
          </div>
          <Field label="Clinical Equipment">
            <Input
              value={roomForm.equipment}
              onChange={(e) => setRoomForm((f) => ({ ...f, equipment: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setRoomModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveRoom}>
              Save Room
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 6: PRESCRIBE REHAB EXERCISE TO PATIENT FILE
      ===================================================================== */}
      <Modal
        open={exerciseModalOpen}
        onClose={() => setExerciseModalOpen(false)}
        title={`Prescribe Rehab Exercise — ${activePatientFile?.patientName || ""}`}
      >
        <div className="space-y-4">
          <Field label="Exercise Name">
            <Input
              value={exerciseForm.exerciseName}
              onChange={(e) => setExerciseForm((f) => ({ ...f, exerciseName: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
            <Field label="Sets / Reps / Tempo / Load">
              <Input
                value={exerciseForm.setsRepsTempo}
                onChange={(e) => setExerciseForm((f) => ({ ...f, setsRepsTempo: e.target.value }))}
              />
            </Field>
            <Field label="Frequency">
              <Input
                value={exerciseForm.frequency}
                onChange={(e) => setExerciseForm((f) => ({ ...f, frequency: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Clinical Target Goal">
            <Input
              value={exerciseForm.targetGoal}
              onChange={(e) => setExerciseForm((f) => ({ ...f, targetGoal: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setExerciseModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleAddExercisePrescription}>
              Add to Patient File
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 7: ASSIGN REHAB PACKAGE TO PATIENT
      ===================================================================== */}
      <Modal
        open={Boolean(assignPkgPatient)}
        onClose={() => setAssignPkgPatient(null)}
        title="Assign Multi-Session Rehab Package"
      >
        {assignPkgPatient && (
          <div className="space-y-4">
            <Field label="Select Patient">
              <Select
                value={assignPkgPatient.id}
                onChange={(e) => {
                  const found = filteredPatients.find((p) => p.id === e.target.value);
                  if (found) setAssignPkgPatient(found);
                }}
              >
                {filteredPatients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientName} ({p.injuryArea})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Select Rehab Package">
              <Select value={assignPkgId} onChange={(e) => setAssignPkgId(e.target.value)}>
                {branchPackages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} — +{pkg.sessionsIncluded} Sessions ({money(pkg.price)})
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={assignPkgPaidNow}
                onChange={(e) => setAssignPkgPaidNow(e.target.checked)}
              />
              Collect payment now &amp; post to Financial Ledger
            </label>
            <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
              <Btn variant="secondary" onClick={() => setAssignPkgPatient(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={handleAssignPackageToPatient}>
                Confirm Package Assignment
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* =====================================================================
          MODAL 8: CREATE NEW REHAB PACKAGE
      ===================================================================== */}
      <Modal
        open={pkgModalOpen}
        onClose={() => setPkgModalOpen(false)}
        title="Create Multi-Session Rehab Package"
      >
        <div className="space-y-4">
          <Field label="Package Name">
            <Input
              value={pkgForm.name}
              onChange={(e) => setPkgForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g., 6-Session Rotator Cuff Rehab Protocol"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
            <Field label="Sessions Included">
              <Input
                type="number"
                value={pkgForm.sessionsIncluded}
                onChange={(e) =>
                  setPkgForm((f) => ({
                    ...f,
                    sessionsIncluded: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Package Price">
              <Input
                type="number"
                value={pkgForm.price}
                onChange={(e) => setPkgForm((f) => ({ ...f, price: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Validity (Days)">
              <Input
                type="number"
                value={pkgForm.validityDays}
                onChange={(e) =>
                  setPkgForm((f) => ({
                    ...f,
                    validityDays: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>
          <Field label="Description">
            <Input
              value={pkgForm.description}
              onChange={(e) => setPkgForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setPkgModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveNewPackage}>
              Create Package
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
};
