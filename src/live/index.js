require("dotenv").config();

const {
  runLiveDiscovery
} = require("./liveDiscovery");

function getArg(
  name
) {
  const index =
    process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return (
    process.argv[index + 1] ||
    null
  );
}

async function main() {
  const service =
    getArg("--service") ||
    "commercial electrical maintenance";

  const location =
    getArg("--location") ||
    "Melbourne, Victoria";

  const experimentId =
    getArg("--experiment");

  const targetValue =
    getArg("--target");

  const target =
    targetValue
      ? Number(targetValue)
      : undefined;

  const result =
    await runLiveDiscovery({
      service,
      location,
      target,
      experimentId
    });

  console.log(
    "\n=========================================="
  );

  console.log(
    "             DISCOVERY RESULT"
  );

  console.log(
    "==========================================\n"
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

main()
  .catch(error => {
    console.error(
      "\nLIVE DISCOVERY ERROR:"
    );

    console.error(
      error.stack ||
      error.message ||
      error
    );

    process.exit(1);
  });
