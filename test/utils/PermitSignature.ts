import { BigNumberish, ethers, Signature } from 'ethers'

export const _PERMIT_DETAILS_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)')
)
export const _PERMIT_SINGLE_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes(
    'PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'
  )
)
export const _PERMIT_BATCH_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes(
    'PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'
  )
)
export const _TOKEN_PERMISSIONS_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('TokenPermissions(address token,uint256 amount)')
)
export const _PERMIT_TRANSFER_FROM_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes(
    'PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)'
  )
)
export const _PERMIT_BATCH_TRANSFER_FROM_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes(
    'PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)'
  )
)

export type PermitDetails = {
  // ERC20 token address
  token: string
  // the maximum amount allowed to spend
  amount: BigNumberish
  // timestamp at which a spender's token allowances become invalid
  //expiration: BigNumber;
  expiration: BigNumberish
  // an incrementing value indexed per owner,token,and spender for each signature
  nonce: BigNumberish
}

export type PermitSingle = {
  // the permit data for a single token allowance
  details: PermitDetails
  // address permissioned on the allowed tokens
  spender: string
  // deadline on the permit signature
  sigDeadline: BigNumberish
}

/// @notice The permit message signed for multiple token allowances
export type PermitBatch = {
  // the permit data for multiple token allowances
  details: PermitDetails[]
  // address permissioned on the allowed tokens
  spender: string
  // deadline on the permit signature
  sigDeadline: BigNumberish
}

/// @notice The saved permissions
/// @dev This info is saved per owner, per token, per spender and all signed over in the permit message
/// @dev Setting amount to type(uint160).max sets an unlimited approval
export type PackedAllowance = {
  // amount allowed
  amount: BigNumberish
  // permission expiry
  expiration: BigNumberish
  // an incrementing value indexed per owner,token,and spender for each signature
  nonce: BigNumberish
}

// @notice A token spender pair.
export type TokenSpenderPair = {
  // the token the spender is approved
  token: string
  // the spender address
  spender: string
}

/// @notice Details for a token transfer.
export type AllowanceTransferDetails = {
  //the owner of the token
  from: string
  //the recipient of the token
  to: string
  //the amount of the token
  amount: BigNumberish
  //the token to be transferred
  token: string
}

export type TokenPermissions = {
  token: string // ERC20 token address
  amount: BigNumberish // the maximum amount that can be spent
}

export type PermitTransferFrom = {
  permitted: TokenPermissions
  nonce: BigNumberish // a unique value for every token owner's signature to prevent signature replays
  deadline: BigNumberish // deadline on the permit signature
}

export type SignatureTransferDetails = {
  to: string // recipient address
  requestedAmount: BigNumberish // spender requested amount
}

export type PermitBatchTransferFrom = {
  permitted: TokenPermissions[] // the tokens and corresponding amounts permitted for a transfer
  nonce: BigNumberish // a unique value for every token owner's signature to prevent signature replays
  deadline: BigNumberish // deadline on the permit signature
}

export type MockWitness = {
  value: BigNumberish
  person: string
  test: boolean
}

export function getCompactPermitSignature(
  permitSingle: PermitSingle,
  privateKey: string,
  domainSeparator: string
): Uint8Array {
  const { compact } = getPermitSignatureSeparated(permitSingle, privateKey, domainSeparator)

  return ethers.utils.concat([compact])
}

export function getPermitSignature(
  permitSingle: PermitSingle,
  privateKey: string,
  domainSeparator: string
): Uint8Array {
  const { v, r, s } = getPermitSignatureSeparated(permitSingle, privateKey, domainSeparator)

  return ethers.utils.concat([r, s, ethers.utils.hexlify(v)])
}

export function getPermitBatchSignature(permitBatch: PermitBatch, privateKey: string, DOMAIN_SEPARATOR: string) {
  let permitDetailsHashes: any[] = []
  for (const i in permitBatch.details) {
    let detail: PermitDetails = permitBatch.details[i]
    permitDetailsHashes[i] = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'address', 'uint160', 'uint48', 'uint48'],
        [_PERMIT_DETAILS_TYPEHASH, detail.token, detail.amount, detail.expiration, detail.nonce]
      )
    )
  }

  const permitHashesHash = ethers.utils.keccak256(ethers.utils.hexConcat(permitDetailsHashes))
  const permitBatchHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint256'],
      [_PERMIT_BATCH_TYPEHASH, permitHashesHash, permitBatch.spender, permitBatch.sigDeadline]
    )
  )
  const hashTypedData = ethers.utils.keccak256(
    ethers.utils.hexConcat([
      ethers.utils.arrayify(ethers.utils.toUtf8Bytes('\x19\x01')),
      DOMAIN_SEPARATOR,
      permitBatchHash,
    ])
  )
  let signer: ethers.utils.SigningKey = new ethers.utils.SigningKey(privateKey)
  const signature: Signature = signer.signDigest(hashTypedData)
  return signature.compact
}

export function getPermitSignatureSeparated(permit: PermitSingle, privateKey: string, DOMAIN_SEPARATOR: string) {
  let permitHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
      [
        _PERMIT_DETAILS_TYPEHASH,
        permit.details.token,
        permit.details.amount,
        permit.details.expiration,
        permit.details.nonce,
      ]
    )
  )

  let hash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint256'],
      [_PERMIT_SINGLE_TYPEHASH, permitHash, permit.spender, permit.sigDeadline]
    )
  )

  let message = ethers.utils.keccak256(
    ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', DOMAIN_SEPARATOR, hash])
  )

  const signingKey: ethers.utils.SigningKey = new ethers.utils.SigningKey(privateKey)
  const signature: Signature = signingKey.signDigest(message)
  const r: ethers.utils.BytesLike = ethers.utils.arrayify(signature.r)
  const s: ethers.utils.BytesLike = ethers.utils.arrayify(signature.s)
  const v: number = signature.v
  const vs: ethers.utils.BytesLike = ethers.utils.arrayify(signature._vs)
  const compact: ethers.utils.BytesLike = ethers.utils.arrayify(signature.compact)
  return { r, s, v, vs, compact }
}

export function signDigestSeparate(message: string, privateKey: string) {
  const signingKey: ethers.utils.SigningKey = new ethers.utils.SigningKey(privateKey)
  const signature: Signature = signingKey.signDigest(message)

  const r: ethers.utils.BytesLike = ethers.utils.arrayify(signature.r)
  const s: ethers.utils.BytesLike = ethers.utils.arrayify(signature.s)
  const v: number = signature.v
  const vs: ethers.utils.BytesLike = ethers.utils.arrayify(signature._vs)
  const compact: ethers.utils.BytesLike = ethers.utils.arrayify(signature.compact)
  return { r, s, v, vs, compact }
}

export function signDigest(hashedPermit: string, privateKey: string): ethers.utils.BytesLike {
  const signingKey: ethers.utils.SigningKey = new ethers.utils.SigningKey(privateKey)
  const signature: Signature = signingKey.signDigest(hashedPermit)
  const r: ethers.utils.BytesLike = ethers.utils.arrayify(signature.r)
  const s: ethers.utils.BytesLike = ethers.utils.arrayify(signature.s)
  const v: number = signature.v
  return ethers.utils.concat([r, s, ethers.utils.hexlify(v)])
}

export function buildAllowanceTransferDetails(
  tokenAddress: string,
  transferAmount: BigNumberish,
  fromAddress: string,
  toAddress: string
): AllowanceTransferDetails {
  return {
    token: tokenAddress,
    amount: transferAmount,
    from: fromAddress,
    to: toAddress,
  }
}

export function buildPermitDetails(
  tokenAddress: string,
  amount: BigNumberish,
  expiration: BigNumberish,
  nonce: BigNumberish
): PermitDetails {
  return {
    token: tokenAddress,
    amount: amount,
    expiration: expiration,
    nonce: nonce,
  }
}

export function buildPermitBatch(permitDetails: PermitDetails[], spender: string, deadline: BigNumberish): PermitBatch {
  return {
    details: permitDetails,
    spender: spender,
    sigDeadline: deadline,
  }
}

export function buildPermitSingle(
  tokenAddress: string,
  amount: BigNumberish,
  expiration: BigNumberish,
  nonce: BigNumberish,
  spender: string,
  deadline: BigNumberish
): PermitSingle {
  return {
    details: {
      token: tokenAddress,
      amount: amount,
      expiration: expiration,
      nonce: nonce,
    },
    spender: spender,
    sigDeadline: deadline,
  }
}

export function getPermitTransferSignature(
  spender: string,
  permit: PermitTransferFrom,
  privateKey: string,
  domainSeparator: string
) {
  let tokenPermissions = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256'],
      [_TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount]
    )
  )

  let permitHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint', 'uint256'],
      [_PERMIT_TRANSFER_FROM_TYPEHASH, tokenPermissions, spender, permit.nonce, permit.deadline]
    )
  )

  let message: string = ethers.utils.keccak256(
    ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, permitHash])
  )

  return signDigest(message, privateKey)
}

export function getCompactPermitTransferSignature(
  spender: string,
  permit: PermitTransferFrom,
  privateKey: string,
  domainSeparator: string
) {
  let tokenPermissions = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256'],
      [_TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount]
    )
  )

  let permitHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint', 'uint256'],
      [_PERMIT_TRANSFER_FROM_TYPEHASH, tokenPermissions, spender, permit.nonce, permit.deadline]
    )
  )

  let message: string = ethers.utils.keccak256(
    ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, permitHash])
  )

  const signingKey: ethers.utils.SigningKey = new ethers.utils.SigningKey(privateKey)
  const signature: Signature = signingKey.signDigest(message)

  return ethers.utils.concat([signature.compact])
}

export function getPermitBatchTransferSignature(
  spender: string,
  permit: PermitBatchTransferFrom,
  privateKey: string,
  domainSeparator: string
) {
  let tokenPermissions = []

  for (let i = 0; i < permit.permitted.length; ++i) {
    tokenPermissions[i] = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'address', 'uint256'],
        [_TOKEN_PERMISSIONS_TYPEHASH, permit.permitted[i].token, permit.permitted[i].amount]
      )
    )
  }

  let permitHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint', 'uint256'],
      [
        _PERMIT_BATCH_TRANSFER_FROM_TYPEHASH,
        ethers.utils.keccak256(ethers.utils.hexConcat(tokenPermissions)),
        spender,
        permit.nonce,
        permit.deadline,
      ]
    )
  )

  let message: string = ethers.utils.keccak256(
    ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, permitHash])
  )

  return signDigest(message, privateKey)
}

export function getPermitBatchWitnessSignature(
  spender: string,
  permit: PermitBatchTransferFrom,
  privateKey: string,
  typeHash: string,
  witness: string,
  domainSeparator: string
) {
  let tokenPermissions = []

  for (let i = 0; i < permit.permitted.length; ++i) {
    tokenPermissions[i] = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'address', 'uint256'],
        [_TOKEN_PERMISSIONS_TYPEHASH, permit.permitted[i].token, permit.permitted[i].amount]
      )
    )
  }

  let permitHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint', 'uint256', 'bytes32'],
      [
        typeHash,
        ethers.utils.keccak256(ethers.utils.hexConcat(tokenPermissions)),
        spender,
        permit.nonce,
        permit.deadline,
        witness,
      ]
    )
  )

  let message: string = ethers.utils.keccak256(
    ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, permitHash])
  )

  return signDigest(message, privateKey)
}

export function getPermitWitnessTransferSignature(
  spender: string,
  permit: PermitTransferFrom,
  privateKey: string,
  typeHash: string,
  witness: string,
  domainSeparator: string
) {
  let tokenPermissions = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256'],
      [_TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount]
    )
  )

  let permitHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'address', 'uint', 'uint256', 'bytes32'],
      [typeHash, tokenPermissions, spender, permit.nonce, permit.deadline, witness]
    )
  )

  let message: string = ethers.utils.keccak256(
    ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, permitHash])
  )

  return signDigest(message, privateKey)
}
