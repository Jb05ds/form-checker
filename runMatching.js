const { matchAgency } = require("./services/matcher");
const path = require("path")

async function run() {

  const agencyName = "Insurance Commission (IC)";
  const csvPath = path.resolve(__dirname, "../csv/tbl_forms_2018_with_agencyName.csv");
  const descriptionColumn = "form_desc";

  await matchAgency(agencyName);
}

run();   