const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const registry = await ethers.getContractAt(
    "NinkRegistry",
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
  );
  const token = await ethers.getContractAt(
    "ProjectNinkToken",
    "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  );

  const fee = await registry.anchorFee();
  const allowance = await token.allowance(signer.address, await registry.getAddress());
  if (allowance < fee) {
    const approveTx = await token.approve(await registry.getAddress(), fee);
    await approveTx.wait();
  }

  const stateHash = ethers.id(`signoff-smoke-${Date.now()}`);
  const tx = await registry.anchorState(stateHash);
  const receipt = await tx.wait();
  console.log("anchorState OK", receipt.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
