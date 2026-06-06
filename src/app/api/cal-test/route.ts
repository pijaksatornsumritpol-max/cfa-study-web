import { NextRequest, NextResponse } from "next/server";
import {
  getStudyPlan,
  googleAuthStatus,
  pushPlanToCalendar,
  saveSettings,
} from "@/app/actions";

// TEMPORARY diagnostic for Google Calendar service-account sync. Remove after testing.
export async function GET(req: NextRequest) {
  const status = await googleAuthStatus();
  if (req.nextUrl.searchParams.get("go") !== "1") {
    return NextResponse.json({
      status,
      hint: "append ?go=1 to actually sync the plan to your calendar",
    });
  }
  // Make sure an exam date is set so the plan generates.
  const sp = await getStudyPlan();
  if (!sp.examDate) await saveSettings({ examDate: "2027-02-16" });
  const result = await pushPlanToCalendar();
  return NextResponse.json({ status, examDate: sp.examDate || "2027-02-16", result });
}
