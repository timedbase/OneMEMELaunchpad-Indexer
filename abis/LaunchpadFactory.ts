export default [
  {
    "type": "event",
    "name": "TokenCreated",
    "inputs": [
      { "name": "token",           "type": "address", "indexed": true  },
      { "name": "creator",         "type": "address", "indexed": true  },
      { "name": "totalSupply",     "type": "uint256", "indexed": false },
      { "name": "virtualBNB",      "type": "uint256", "indexed": false },
      { "name": "migrationTarget", "type": "uint256", "indexed": false },
      { "name": "antibotEnabled",  "type": "bool",    "indexed": false },
      { "name": "tradingBlock",    "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "function",
    "name": "createToken",
    "stateMutability": "payable",
    "inputs": [{
      "name": "p", "type": "tuple",
      "components": [
        { "name": "name",               "type": "string"  },
        { "name": "symbol",             "type": "string"  },
        { "name": "supplyOption",       "type": "uint8"   },
        { "name": "enableCreatorAlloc", "type": "bool"    },
        { "name": "enableAntibot",      "type": "bool"    },
        { "name": "antibotBlocks",      "type": "uint256" },
        { "name": "metaURI",            "type": "string"  },
        { "name": "salt",               "type": "bytes32" }
      ]
    }],
    "outputs": [{ "name": "token", "type": "address" }]
  },
  {
    "type": "function",
    "name": "createTT",
    "stateMutability": "payable",
    "inputs": [{
      "name": "p", "type": "tuple",
      "components": [
        { "name": "name",               "type": "string"  },
        { "name": "symbol",             "type": "string"  },
        { "name": "metaURI",            "type": "string"  },
        { "name": "supplyOption",       "type": "uint8"   },
        { "name": "enableCreatorAlloc", "type": "bool"    },
        { "name": "enableAntibot",      "type": "bool"    },
        { "name": "antibotBlocks",      "type": "uint256" },
        { "name": "salt",               "type": "bytes32" }
      ]
    }],
    "outputs": [{ "name": "token", "type": "address" }]
  },
  {
    "type": "function",
    "name": "createRFL",
    "stateMutability": "payable",
    "inputs": [{
      "name": "p", "type": "tuple",
      "components": [
        { "name": "name",               "type": "string"  },
        { "name": "symbol",             "type": "string"  },
        { "name": "metaURI",            "type": "string"  },
        { "name": "supplyOption",       "type": "uint8"   },
        { "name": "enableCreatorAlloc", "type": "bool"    },
        { "name": "enableAntibot",      "type": "bool"    },
        { "name": "antibotBlocks",      "type": "uint256" },
        { "name": "salt",               "type": "bytes32" }
      ]
    }],
    "outputs": [{ "name": "token", "type": "address" }]
  },
  {
    "type": "function",
    "name": "standardImpl",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }]
  },
  {
    "type": "function",
    "name": "taxImpl",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }]
  },
  {
    "type": "function",
    "name": "reflectionImpl",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }]
  },
  {
    "type": "function",
    "name": "predictTokenAddress",
    "stateMutability": "view",
    "inputs": [
      { "name": "creator_",  "type": "address" },
      { "name": "userSalt_", "type": "bytes32" },
      { "name": "impl_",     "type": "address" }
    ],
    "outputs": [{ "name": "predicted", "type": "address" }]
  },
  {
    "type": "function",
    "name": "getAntibotBlocksRange",
    "stateMutability": "pure",
    "inputs": [],
    "outputs": [
      { "name": "min", "type": "uint256" },
      { "name": "max", "type": "uint256" }
    ]
  }
] as const;
