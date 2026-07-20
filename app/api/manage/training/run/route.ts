import { runTrainingRequest } from "../../../dev/training/run/route";

export async function POST(request: Request) {
  return runTrainingRequest(request, true);
}
