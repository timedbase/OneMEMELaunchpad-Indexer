export default [
  {
    "type": "event",
    "name": "TokenBought",
    "inputs": [
      { "name": "token",        "type": "address", "indexed": true  },
      { "name": "buyer",        "type": "address", "indexed": true  },
      { "name": "bnbIn",        "type": "uint256", "indexed": false },
      { "name": "tokensOut",    "type": "uint256", "indexed": false },
      { "name": "tokensToDead", "type": "uint256", "indexed": false },
      { "name": "raisedBNB",    "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "TokenSold",
    "inputs": [
      { "name": "token",     "type": "address", "indexed": true  },
      { "name": "seller",    "type": "address", "indexed": true  },
      { "name": "tokensIn",  "type": "uint256", "indexed": false },
      { "name": "bnbOut",    "type": "uint256", "indexed": false },
      { "name": "raisedBNB", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "TokenMigrated",
    "inputs": [
      { "name": "token",           "type": "address", "indexed": true  },
      { "name": "pair",            "type": "address", "indexed": true  },
      { "name": "liquidityBNB",    "type": "uint256", "indexed": false },
      { "name": "liquidityTokens", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "function",
    "name": "getAmountOut",
    "stateMutability": "view",
    "inputs": [
      { "name": "token_",  "type": "address" },
      { "name": "bnbIn",   "type": "uint256" }
    ],
    "outputs": [
      { "name": "tokensOut", "type": "uint256" },
      { "name": "feeBNB",    "type": "uint256" }
    ]
  },
  {
    "type": "function",
    "name": "getAmountOutSell",
    "stateMutability": "view",
    "inputs": [
      { "name": "token_",   "type": "address" },
      { "name": "tokensIn", "type": "uint256" }
    ],
    "outputs": [
      { "name": "bnbOut", "type": "uint256" },
      { "name": "feeBNB", "type": "uint256" }
    ]
  },
  {
    "type": "function",
    "name": "getSpotPrice",
    "stateMutability": "view",
    "inputs": [
      { "name": "token_", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "type": "function",
    "name": "getToken",
    "stateMutability": "view",
    "inputs": [
      { "name": "token_", "type": "address" }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          { "name": "token",           "type": "address" },
          { "name": "creator",         "type": "address" },
          { "name": "totalSupply",     "type": "uint256" },
          { "name": "liquidityTokens", "type": "uint256" },
          { "name": "creatorTokens",   "type": "uint256" },
          { "name": "bcTokensTotal",   "type": "uint256" },
          { "name": "bcTokensSold",    "type": "uint256" },
          { "name": "virtualBNB",      "type": "uint256" },
          { "name": "k",               "type": "uint256" },
          { "name": "raisedBNB",       "type": "uint256" },
          { "name": "migrationTarget", "type": "uint256" },
          { "name": "pair",            "type": "address" },
          { "name": "router",          "type": "address" },
          { "name": "antibotEnabled",  "type": "bool"    },
          { "name": "creationBlock",   "type": "uint256" },
          { "name": "tradingBlock",    "type": "uint256" },
          { "name": "migrated",        "type": "bool"    }
        ]
      }
    ]
  },
  {
    "type": "function",
    "name": "totalTokensLaunched",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "type": "function",
    "name": "allTokens",
    "stateMutability": "view",
    "inputs": [
      { "name": "", "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "address" }]
  },
  {
    "type": "function",
    "name": "getTokensByCreator",
    "stateMutability": "view",
    "inputs": [
      { "name": "creator_", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "address[]" }]
  },
  {
    "type": "function",
    "name": "tokenCountByCreator",
    "stateMutability": "view",
    "inputs": [
      { "name": "creator_", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256" }]
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
