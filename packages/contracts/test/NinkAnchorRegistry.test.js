const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NinkAnchorRegistry", function () {
  const platformId = 1;
  const timestamp = 1_704_000_000n;

  async function deployRegistry() {
    const [owner] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("NinkAnchorRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();
    return { registry, owner };
  }

  function sampleStateHash(label = "nink-session-state") {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  it("anchors a proof, sets isAnchored, and emits LogAnchorCreated", async function () {
    const { registry, owner } = await deployRegistry();
    const stateHash = sampleStateHash();

    await expect(registry.anchorProof(stateHash, platformId, timestamp))
      .to.emit(registry, "LogAnchorCreated")
      .withArgs(stateHash, owner.address, platformId, timestamp);

    expect(await registry.isAnchored(stateHash)).to.equal(true);
  });

  it("reverts when anchoring the same state hash twice", async function () {
    const { registry } = await deployRegistry();
    const stateHash = sampleStateHash("duplicate-test");

    await registry.anchorProof(stateHash, platformId, timestamp);

    await expect(registry.anchorProof(stateHash, platformId, timestamp + 1n))
      .to.be.revertedWithCustomError(registry, "AlreadyAnchored")
      .withArgs(stateHash);
  });

  it("allows different state hashes for the same platform", async function () {
    const { registry } = await deployRegistry();
    const first = sampleStateHash("first");
    const second = sampleStateHash("second");

    await registry.anchorProof(first, platformId, timestamp);
    await registry.anchorProof(second, platformId, timestamp + 10n);

    expect(await registry.isAnchored(first)).to.equal(true);
    expect(await registry.isAnchored(second)).to.equal(true);
  });
});
