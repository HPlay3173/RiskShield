import { DatasetConsole, type InitialCsvMetadataTuple } from "../../../components/developer/DatasetConsole";
import { DeveloperShell } from "../../../components/shell/AreaShells";
import { protectedProductPage } from "../../../lib/product-page";

const INITIAL_CSV_METADATA: InitialCsvMetadataTuple = [
  {
    id: "controversial-keywords",
    fileName: "controversial_keywords_10000.csv",
    availability: "available",
    validation: "valid",
    byteSize: 599_541,
    rowCount: 10_000,
    sha256: "21effaaf3a1285168f6d40cc276c7dc08d249e10baaef212706b5df94fe948ea",
    checkedAt: "2026-07-19T18:44:38.498Z",
    message: "원본 위치에서 read-only 전체 행 검증 통과",
  },
  {
    id: "false-advertising-keywords",
    fileName: "false_advertising_keywords_10000.csv",
    availability: "available",
    validation: "valid",
    byteSize: 1_011_091,
    rowCount: 10_000,
    sha256: "1737abadfad3ee23afedfc80e0dbbb09912cb2f697c851784c5336a88161c15a",
    checkedAt: "2026-07-19T18:44:38.498Z",
    message: "원본 위치에서 read-only 전체 행 검증 통과",
  },
  {
    id: "hate-speech-dictionary",
    fileName: "hate_speech_filtering_dictionary.csv",
    availability: "available",
    validation: "valid",
    byteSize: 2_460_243,
    rowCount: 10_000,
    sha256: "ec6777467d8df469f6edd763981da5f81522a71da9f25a0338dbbc3f1f6db572",
    checkedAt: "2026-07-19T18:44:38.498Z",
    message: "원본 위치에서 read-only 전체 행 검증 통과",
  },
];

export default async function DatasetsPage() {
  const { principal, presentation, repositories } = await protectedProductPage("/dev/datasets", "dataset:manage");
  const datasets = await repositories.datasets.list();
  const configurationMessage = datasets.status === "configuration_required"
    ? `${datasets.message} ${datasets.missing.join(", ")}`
    : datasets.status === "unavailable"
      ? datasets.message
      : null;
  return (
    <DeveloperShell currentHref="/dev/datasets" principal={presentation} title="데이터셋" description="원본 CSV를 byte-exact로 검사하고 provenance와 column mapping을 확인한 뒤 staging Dataset Version으로만 등록합니다.">
      <DatasetConsole
        initialCsvMetadata={INITIAL_CSV_METADATA}
        stagingEndpoint="/api/dev/datasets/register"
        csrfToken={principal.csrfToken}
        developmentFixture={repositories.developmentFixture}
        configurationMessage={configurationMessage}
      />
    </DeveloperShell>
  );
}
