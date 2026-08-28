const {
  runGrowthEngine
} = require("./growthEngine");

function getArg(
  name
) {
  const index =
    process.argv.indexOf(
      name
    );

  if (
    index === -1
  ) {
    return null;
  }

  return (
    process.argv[
      index + 1
    ] || null
  );
}

async function main() {
  const experimentId =
    getArg(
      "--experiment"
    );

  const service =
    getArg(
      "--service"
    );

  const location =
    getArg(
      "--location"
    );

  console.log(
    "\n=========================================="
  );

  console.log(
    "              GROWTH ENGINE"
  );

  console.log(
    "==========================================\n"
  );

  const result =
    await runGrowthEngine({
      experimentId,
      service,
      location
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

main()
  .catch(
    error => {
      console.error(
        "\nGROWTH ENGINE ERROR:"
      );

      console.error(
        error.stack ||
        error.message ||
        error
      );

      process.exit(1);
    }
  );
