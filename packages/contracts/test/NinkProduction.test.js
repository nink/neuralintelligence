const { expect } = require("chai");
const { ethers } = require("hardhat");

const INITIAL_ANCHOR_FEE = 10_000_000_000_000_000n;
const TOTAL_SUPPLY = 100_000_000n * 10n ** 18n;
const LOWER_FEE = 100_000_000_000_000n; // 0.0001 NINK

describe("ProjectNinkToken", function () {
  it("mints exactly 100M NINK to the deployer with 18 decimals", async function () {
    const [deployer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ProjectNinkToken");
    const token = await Token.deploy(deployer.address);

    expect(await token.name()).to.equal("Project NINK");
    expect(await token.symbol()).to.equal("NINK");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(deployer.address)).to.equal(TOTAL_SUPPLY);
    expect(await token.TOTAL_SUPPLY()).to.equal(TOTAL_SUPPLY);
  });
});

describe("NinkRegistry", function () {
  async function deployFixture() {
    const [owner, user, treasury] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ProjectNinkToken");
    const token = await Token.deploy(owner.address);

    const Registry = await ethers.getContractFactory("NinkRegistry");
    const registry = await Registry.deploy(
      owner.address,
      await token.getAddress(),
      treasury.address
    );

    await token.transfer(user.address, ethers.parseEther("1000"));
    return { owner, user, treasury, token, registry };
  }

  it("starts with anchorFee of 0.01 NINK", async function () {
    const { registry } = await deployFixture();
    expect(await registry.anchorFee()).to.equal(INITIAL_ANCHOR_FEE);
    expect(await registry.INITIAL_ANCHOR_FEE()).to.equal(INITIAL_ANCHOR_FEE);
  });

  it("allows owner to lower anchorFee", async function () {
    const { owner, registry } = await deployFixture();

    await expect(registry.connect(owner).setAnchorFee(LOWER_FEE))
      .to.emit(registry, "AnchorFeeUpdated")
      .withArgs(INITIAL_ANCHOR_FEE, LOWER_FEE);

    expect(await registry.anchorFee()).to.equal(LOWER_FEE);
  });

  it("rejects setAnchorFee from non-owner", async function () {
    const { user, registry } = await deployFixture();
    await expect(
      registry.connect(user).setAnchorFee(LOWER_FEE)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("anchorState pulls fee via transferFrom and emits AnchorRecorded", async function () {
    const { user, treasury, token, registry } = await deployFixture();
    const stateHash = ethers.id("session-state-v1");
    const registryAddress = await registry.getAddress();

    await token.connect(user).approve(registryAddress, INITIAL_ANCHOR_FEE);

    const treasuryBefore = await token.balanceOf(treasury.address);
    const userBefore = await token.balanceOf(user.address);

    await expect(registry.connect(user).anchorState(stateHash))
      .to.emit(registry, "AnchorRecorded")
      .withArgs(stateHash, user.address, INITIAL_ANCHOR_FEE);

    expect(await token.balanceOf(treasury.address)).to.equal(
      treasuryBefore + INITIAL_ANCHOR_FEE
    );
    expect(await token.balanceOf(user.address)).to.equal(
      userBefore - INITIAL_ANCHOR_FEE
    );
  });

  it("reverts anchorState without sufficient allowance", async function () {
    const { user, registry } = await deployFixture();
    const stateHash = ethers.id("session-state-v2");

    await expect(
      registry.connect(user).anchorState(stateHash)
    ).to.be.reverted;
  });

  it("reverts anchorState for zero hash", async function () {
    const { user, registry } = await deployFixture();
    await expect(
      registry.connect(user).anchorState(ethers.ZeroHash)
    ).to.be.revertedWith("NinkRegistry: empty hash");
  });
});
