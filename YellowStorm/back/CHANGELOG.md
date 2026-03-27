# Backend Changelog

All notable changes to the YelloStorm backend.

## [0.1.0](https://github.com/YellowsysOrg/YellowStorm/compare/back-v0.0.2...back-v0.1.0) (2026-02-12)


### ⚠ BREAKING CHANGES

* **api:**  migrated to use /v1/models/info endpoint in litellm api,  restructured the models response type

### Features

* **agent-type:** added agent type slug [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([a7b5954](https://github.com/YellowsysOrg/YellowStorm/commit/a7b595409e7403d2f8cb11dea9debce3ec5668cb))
* **agent:** added the agents management REST api [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([ec942ee](https://github.com/YellowsysOrg/YellowStorm/commit/ec942ee86481998b4798961f1006177ee607115c))
* **agent:** backend now only sends tagged agents [#164](https://github.com/YellowsysOrg/YellowStorm/issues/164) ([c193afa](https://github.com/YellowsysOrg/YellowStorm/commit/c193afa3559b45da7ebf0f14981584d804e02698))
* **agent:** each agent can now have seleced tools and workspaces [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([3efdefe](https://github.com/YellowsysOrg/YellowStorm/commit/3efdefee3af867a949be9ec695bd2b2398035331))
* **agent:** each agent type now has a prompt per model [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([046fc1e](https://github.com/YellowsysOrg/YellowStorm/commit/046fc1e4fd90ea4b19796a56ff55ad70fd25e806))
* **agent:** fixed regeneration and copy paste ([b170ebb](https://github.com/YellowsysOrg/YellowStorm/commit/b170ebbb4049eb1b0d894e78c8997b786f20213f))
* **agents:** changed description to role in grpc request [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([1e429e8](https://github.com/YellowsysOrg/YellowStorm/commit/1e429e86832dc79632dbbae8cfe94f10f7fa1049))
* **agent:** updated proto to allign with API request [#164](https://github.com/YellowsysOrg/YellowStorm/issues/164) ([df128a0](https://github.com/YellowsysOrg/YellowStorm/commit/df128a079397f18f04138787849ca11f2605f1ff))
* **api:**  migrated to use /v1/models/info endpoint in litellm api,  restructured the models response type ([138fd7a](https://github.com/YellowsysOrg/YellowStorm/commit/138fd7acafeae8fb473ec4591d49e3e5ac9a303e))
* **maintenance:** added role to skip maintenance for admins ([6694475](https://github.com/YellowsysOrg/YellowStorm/commit/669447585f3a3b37c8a903294af954138911c098))
* **maintenance:** local env will now skip checking maintenance ([c010a37](https://github.com/YellowsysOrg/YellowStorm/commit/c010a376b7027e4da7ee0df23d8783d2f034fc76))
* **stream:** added model in agent from request ([8e56d92](https://github.com/YellowsysOrg/YellowStorm/commit/8e56d92aa3e6097efaa243b07d29bde2985fe681))
* **tag-agent:** manager is now always sent in the request ([b53c353](https://github.com/YellowsysOrg/YellowStorm/commit/b53c353ffdb79859cea541e1528f6006b132c650))
* **tools:** Added Tool management (CRUD)  [#159](https://github.com/YellowsysOrg/YellowStorm/issues/159) ([4a03d30](https://github.com/YellowsysOrg/YellowStorm/commit/4a03d30e5655726f09fe97b6f4ce0c2e3934bf01))


### Bug Fixes

* **agent:** fixed model not updating ([61d32ae](https://github.com/YellowsysOrg/YellowStorm/commit/61d32aeb6679223a96e3f6d8b81dfe0062438d71))
* **proto:** workspace context is now an array ([d8e6f79](https://github.com/YellowsysOrg/YellowStorm/commit/d8e6f79e9070a5e4759ed6f40257e51e7ac1f4da))

## [0.0.2](https://github.com/YellowsysOrg/YellowStorm/compare/back-v0.0.1...back-v0.0.2) (2026-02-06)


### Features

* added support for pptx ([3bf577c](https://github.com/YellowsysOrg/YellowStorm/commit/3bf577ccf56918d590b3b7c8cb46defaa74fb81b))
* changed default url to 0.0.0.0 ([8af55a8](https://github.com/YellowsysOrg/YellowStorm/commit/8af55a814fa65bb67307724dd85c8c60a8d16c89))
* **conversation-stream:** added workspace context to the stream request ([192445a](https://github.com/YellowsysOrg/YellowStorm/commit/192445a791e63f002f19ceed0c0f9a9a056cbeea))
* **conversation:** added endpoint to fetch all documents in a list of workspaces ([2825457](https://github.com/YellowsysOrg/YellowStorm/commit/282545768d1ce7f761fa1f2f80d9c6b00662781d))
* **file-viewer:** you can now open fileviewer from sources ([4e7cb94](https://github.com/YellowsysOrg/YellowStorm/commit/4e7cb944342244757d54b4e6655f73acf6d8e4f7))
* **index-url:** changed auth url ([161f2fa](https://github.com/YellowsysOrg/YellowStorm/commit/161f2fadd114251ee7b8036e4532c2ab4fb718d3))
* **indexing:** add document indexing module with real-time notifications ([8eb3923](https://github.com/YellowsysOrg/YellowStorm/commit/8eb3923b61de06936dd339d65662acb2740dc4f9))
* **indexing:** Added Delete document to the indexing module ([3961065](https://github.com/YellowsysOrg/YellowStorm/commit/3961065a7a6d8bafc56d800d21eea90dac2d28d4))
* **indexing:** added delete index ([9093dc2](https://github.com/YellowsysOrg/YellowStorm/commit/9093dc28ae671dffaa77901b44bad329027a26f9))
* **indexing:** removed hardcoded vectorstore_name ([7dbd459](https://github.com/YellowsysOrg/YellowStorm/commit/7dbd459cccbd269bbb3fced2508184451aa92937))
* **indexing:** replaced mocked API request with real api context ([c6c879f](https://github.com/YellowsysOrg/YellowStorm/commit/c6c879fcdff0d921066924281d2e6957a4d9c984))
* **stream:** added new prompt ([90df7b5](https://github.com/YellowsysOrg/YellowStorm/commit/90df7b5253c5ec62f90fd968be24a5de5c6d47d6))
* **workspace-index:** added new files in document schema ([10456a7](https://github.com/YellowsysOrg/YellowStorm/commit/10456a7802c12a051a85ea26286a94510a8c462e))


### Bug Fixes

* **admin:** fixed a problem where when an admin logs in they can't see the admin section untill they refresh the page ([3e5d9a8](https://github.com/YellowsysOrg/YellowStorm/commit/3e5d9a8d6db665b34e6f640e4494ca162d6e871d))
* **document:** download url now checks if blob exists before generating a download URL with sas token ([89d3988](https://github.com/YellowsysOrg/YellowStorm/commit/89d39888239b20be857dd4aa297e628a1c8d56b9))
* **indexing-webhook:** fixed validation pipe ([3f602cb](https://github.com/YellowsysOrg/YellowStorm/commit/3f602cb2641d85287949221c17f65b87444bccdd))
* **indexing-webhook:** fixed validation pipe ([c16792d](https://github.com/YellowsysOrg/YellowStorm/commit/c16792d482b6634ad7a529549f0184b73fa64e19))
* **indexing:** removed hardcoded webhook ([d46f48e](https://github.com/YellowsysOrg/YellowStorm/commit/d46f48e3cc574cdf38434c7a68dc28bb7db7b93c))
* **logger:** fixed logger missing requestId in all logs ([3538ac3](https://github.com/YellowsysOrg/YellowStorm/commit/3538ac3ccb03ee5802def19eb888412839054cc2))
* **notifications:** fixed stale connection clean up ([943edc5](https://github.com/YellowsysOrg/YellowStorm/commit/943edc5c3fc19b0529422e93a4874ec8568a83c9))
* **prompt:** fixed prompt ([7877e76](https://github.com/YellowsysOrg/YellowStorm/commit/7877e760229354a1e3f19d659756d6037799ad6f))
* **proto:** added proto file to assets folder and updated path ([afb1624](https://github.com/YellowsysOrg/YellowStorm/commit/afb162416e96f288f7942654a884dd40a7c8773e))
* **proto:** fixed proto build ([7d81150](https://github.com/YellowsysOrg/YellowStorm/commit/7d811503c0050fcefb44a00574c47fe3f9fed15c))
* **proto:** fixed proto path ([5afb95a](https://github.com/YellowsysOrg/YellowStorm/commit/5afb95aba6d5183eb37b18c301a52251c54e6ab5))
* **security:** add rate limiting to webhook and prevent regex injection ([fbed5e6](https://github.com/YellowsysOrg/YellowStorm/commit/fbed5e68aed76f0d730ed9d75b03cae76afbcc94))
* **workspace:** -fixed delete all workspace documents returning error 500 ([351bf58](https://github.com/YellowsysOrg/YellowStorm/commit/351bf581bf948f8035513fa200323fab993f24e1))
* **workspace:** fixed delete all workspace files not recalculating the remaining storage space ([80b5cb4](https://github.com/YellowsysOrg/YellowStorm/commit/80b5cb4d4cdb06b8b1edbb72bf91fa98b0dbc615))


### Performance

* **document:** generate sas url now takes new option (checkExists) default to false ([e4a08a6](https://github.com/YellowsysOrg/YellowStorm/commit/e4a08a69098de47eb80078c24dc56c2aab86adbb))
* fixed packages vulnerabilities ([f233b82](https://github.com/YellowsysOrg/YellowStorm/commit/f233b8257e733ca18089174e0b513808266dd1f2))
* **mock-grpc:** updated mock grpc server ([811bf6d](https://github.com/YellowsysOrg/YellowStorm/commit/811bf6d06a14d760c6513d6b480d93276ff3b17f))
* **workspace-indexing:** improved the index retry logic ([5198b92](https://github.com/YellowsysOrg/YellowStorm/commit/5198b92074e4be666c880b4decd317d2d36bf37f))


### Refactoring

* **email:** disabld saving reconnection logs ([f8fe77a](https://github.com/YellowsysOrg/YellowStorm/commit/f8fe77a5cd4006c945938981a92a837a2956a5c5))
* **prompt:** removed agent names ([0f207a2](https://github.com/YellowsysOrg/YellowStorm/commit/0f207a22ffa5b4804b3473ecd328c67fe94e62e2))

## 0.0.1 (2026-02-02)


### Features

* add 'sources' type to MessageComponent and update related schema and utility functions ([eb2d7f6](https://github.com/YellowsysOrg/YellowStorm/commit/eb2d7f637b099714cd36a7902a951e3c5f488899))
* add agent_mode property to StreamRequest for manual agent configuration ([115e266](https://github.com/YellowsysOrg/YellowStorm/commit/115e266bb681ebf16e23e1697402edf024116f85))
* add Bot icon rendering in PlanPartRenderer for agent display ([f4bb3f5](https://github.com/YellowsysOrg/YellowStorm/commit/f4bb3f5024e3266ac682e925da03895297bd156a))
* add conversation ID check for stream events in conversation store ([1310cf5](https://github.com/YellowsysOrg/YellowStorm/commit/1310cf5a78ac6f09d5b0e4ba19375e4fe04d593f))
* add delete conversation functionality with confirmation dialog ([e440ebd](https://github.com/YellowsysOrg/YellowStorm/commit/e440ebd857bd7331d8d91dafafffbec3e8eab726))
* add download functionality for code and web preview components ([a09d5c8](https://github.com/YellowsysOrg/YellowStorm/commit/a09d5c8687c968c914697274511a57c11e0a880d))
* add error handling components and update message types across the application ([647a026](https://github.com/YellowsysOrg/YellowStorm/commit/647a026e8d54b2f1b48575e4eeb2307871de7b09))
* add isStreaming prop to AIMessageContent and ChatMessageBubble for better streaming handling ([6d651dd](https://github.com/YellowsysOrg/YellowStorm/commit/6d651ddc56898a6fa0a0712df99516ba80944bbf))
* add known issues documentation for workspace modal and layout problems ([fed0f3e](https://github.com/YellowsysOrg/YellowStorm/commit/fed0f3e8a739ba4ce421582c7ff5aeffc6d868e6))
* add logging for incoming gRPC data chunks in StreamService ([4e3e356](https://github.com/YellowsysOrg/YellowStorm/commit/4e3e356833313d4a06244076d4fe78db6588001c))
* add support for web preview component in markdown conversion ([a948bec](https://github.com/YellowsysOrg/YellowStorm/commit/a948bec968a37c0b79ff3cea30c8c176d1af7ea5))
* add task component support in message schema and related utilities ([781b55a](https://github.com/YellowsysOrg/YellowStorm/commit/781b55a7ad21ddadebbb378ba3b09cb92e7abde0))
* add usage tracking guards to sendMessage and regenerate methods ([e43646a](https://github.com/YellowsysOrg/YellowStorm/commit/e43646a4ccfc28fc6e0b3143d2353da7a05d2d1a))
* better sidebar, and sidebar behaivour ([8d814e9](https://github.com/YellowsysOrg/YellowStorm/commit/8d814e95d9c374fb020e6fdb10f53fcf86bd79d5))
* enhance component handling in StreamService and update proto definitions for new component types ([986f697](https://github.com/YellowsysOrg/YellowStorm/commit/986f697cc6203c432125860007006cc0f0b65f38))
* enhance content merging for 'code' type in StreamService and store ([d1d39d4](https://github.com/YellowsysOrg/YellowStorm/commit/d1d39d46d782dfc6ab0c0cf3f694f421363bc545))
* enhance message loading with scroll position preservation and loading indicators ([3ef640b](https://github.com/YellowsysOrg/YellowStorm/commit/3ef640b2066f23248c49045cfff5298f09a8b7fb))
* enhance plan and usage tracking in conversation module with updated structures and rendering ([a81070d](https://github.com/YellowsysOrg/YellowStorm/commit/a81070d3d2d5975e04d808bde5b9c9212af083c1))
* enhance StarsBackground component with improved star management and shooting star effects ([9bdfe58](https://github.com/YellowsysOrg/YellowStorm/commit/9bdfe58d183f01c03f70f230365169888e0e1f61))
* implement conversation name generation and typewriter effect for display ([b192589](https://github.com/YellowsysOrg/YellowStorm/commit/b1925898b9345debc68305cb209b97d3cd103dd1))
* implement frontend buffering for throttled delivery of stream chunks ([c93896d](https://github.com/YellowsysOrg/YellowStorm/commit/c93896df08712789e4ac6bc9cc986fb4afe919cf))
* implement streaming buffer for batched updates to enhance performance ([85705b2](https://github.com/YellowsysOrg/YellowStorm/commit/85705b297c86199282ba27eaf62035cb3e0fa02c))
* implement streaming components for queue, plan, and checkpoint with proper data handling ([60f8b20](https://github.com/YellowsysOrg/YellowStorm/commit/60f8b20e3cc534b34116ee4fb6e9d34049c78b74))
* implement timestamp formatting for chat messages ([f102dbc](https://github.com/YellowsysOrg/YellowStorm/commit/f102dbc1a80c0011ff4164fc6209b50ed082a21d))
* implement web preview component and context for message handling ([4040229](https://github.com/YellowsysOrg/YellowStorm/commit/4040229376700c7aa196317949bbec62e0df60fd))
* improve layout and responsiveness across conversation and sidebar components ([16b2c7e](https://github.com/YellowsysOrg/YellowStorm/commit/16b2c7e4f50fd7a28df622cd1dd568c84511f5ed))
* improve layout and spacing in ChatConversationContent and ChatMessageBubble components ([7aecf7d](https://github.com/YellowsysOrg/YellowStorm/commit/7aecf7db479cae2dc166cf70ac752bd73cf0fbdf))
* integrate usage tracking in conversation module and update related services ([926cbfd](https://github.com/YellowsysOrg/YellowStorm/commit/926cbfd06cb77b6ca7f5a72a43a227909b743b3c))
* refactor AppSidebar to use history panel state and remove unused state ([4d7d832](https://github.com/YellowsysOrg/YellowStorm/commit/4d7d832c0c35a1620c92b817e7ea0b923a51db2a))
* refine outputAvailable logic in conversation data handling ([9aff81c](https://github.com/YellowsysOrg/YellowStorm/commit/9aff81ca92a59d0c4e7fa0ef825dde710600cfc2))


### Bug Fixes

* added messages loading state to conversation components ([0f697c9](https://github.com/YellowsysOrg/YellowStorm/commit/0f697c902b00c6044d1dd1e527f1a4417620c19a))
* added workspace_context ([3f7ef11](https://github.com/YellowsysOrg/YellowStorm/commit/3f7ef11a67f1c0994deeb803e4d6e7cac4029baf))
* adjust styling for Plan and Task components to improve layout ([d278ab3](https://github.com/YellowsysOrg/YellowStorm/commit/d278ab3f391520a2ee2224fc1d8d8b1163e2df5b))
* changed timestamp position for user's message ([d49591d](https://github.com/YellowsysOrg/YellowStorm/commit/d49591dca182236321363a95864196b5b0e273f7))
* correct syntax errors in Usage and StreamChunk messages ([81f4eb1](https://github.com/YellowsysOrg/YellowStorm/commit/81f4eb1c6b67f176ef66752da81f97dc31ef4fd5))
* disabled folders button ([6eb9c9e](https://github.com/YellowsysOrg/YellowStorm/commit/6eb9c9e470dfb6f812c08d488ec3c30e1947e831))
* enhance layout for PlanPartRenderer and ChatMessageBubble components for better alignment ([433ad76](https://github.com/YellowsysOrg/YellowStorm/commit/433ad763c94ee9b085cf96ad328af1cbee66a1a0))
* fixed appsidebar zindex ([3b672d2](https://github.com/YellowsysOrg/YellowStorm/commit/3b672d23ac4f7107287cf4aa7be14ce235c5e27e))
* fixed backend ([70a575e](https://github.com/YellowsysOrg/YellowStorm/commit/70a575e34f8ff68f3594eb12ac3e50bb7b70c0b2))
* fixed code artifact copy to clipboard ([d44ecb0](https://github.com/YellowsysOrg/YellowStorm/commit/d44ecb072e38ca334b0a3ff4bb3846cde691a168))
* fixed name generation missing model id ([ff4240d](https://github.com/YellowsysOrg/YellowStorm/commit/ff4240df1e2b633aea443cef1bc43c9d3d78a12e))
* fixed reasoning component ([b39b30e](https://github.com/YellowsysOrg/YellowStorm/commit/b39b30e47fe64cb08879a16b0edcfa87121a5280))
* fixed workspace_context ([c90f087](https://github.com/YellowsysOrg/YellowStorm/commit/c90f087da564dcab6c4fbbc593bcc113564e7dc8))
* fixed workspace_context ([6382567](https://github.com/YellowsysOrg/YellowStorm/commit/638256741d5014f6003d6e08fd6e94659cd660bb))
* implement idle timeout for stream calls to enhance error handling ([4f163b2](https://github.com/YellowsysOrg/YellowStorm/commit/4f163b2ff6b4469e62e605eb78dac67cd6112e41))
* reduce flush interval in StreamingBuffer to improve rendering performance ([ea9134b](https://github.com/YellowsysOrg/YellowStorm/commit/ea9134b177001fcfd03aaab46d33aa695e533f5a))
* remoed .env.example ([29c992d](https://github.com/YellowsysOrg/YellowStorm/commit/29c992d5bfb447b9fa97313667902e2586850741))
* set full height for conversation page container ([3ae8332](https://github.com/YellowsysOrg/YellowStorm/commit/3ae8332ce58bb87b9d7ec016f27d326994d42743))
* update conversation fetch limit to use DEFAULT_CONVERSATIONS_LIMIT unstable 0.0.1 ([c1d0d14](https://github.com/YellowsysOrg/YellowStorm/commit/c1d0d14341bf87807f7ad1a0988c5527b2d5ab0f))
* update edit condition to use canEdit for user message actions ([1eaa92f](https://github.com/YellowsysOrg/YellowStorm/commit/1eaa92f7120f436266e756da12a75b2e41cc625e))
* update layout for Plan and ChatMessageBubble components to enhance responsiveness ([47375c5](https://github.com/YellowsysOrg/YellowStorm/commit/47375c57eae59fb37ca291192fea26a0557af037))
* update privacy message in DataControlsSection to clarify data sharing policy ([36cd210](https://github.com/YellowsysOrg/YellowStorm/commit/36cd2103a272fc85fbd6904a58170efda03ab2ed))
* update section numbers and enhance troubleshooting guidance in adding-components documentation ([5ca5d7c](https://github.com/YellowsysOrg/YellowStorm/commit/5ca5d7cbb389c378aae4a39809d986bf168c4009))


### Refactoring

* fixing repo ([ea45ca5](https://github.com/YellowsysOrg/YellowStorm/commit/ea45ca5ca490b1beff6227474e35b7e066112844))
* improve conversation retrieval logic in useConversations hook ([179a196](https://github.com/YellowsysOrg/YellowStorm/commit/179a196b651790fb7693d35fa73f1ab3287cd993))
* optimized conversation scroll ([d325b89](https://github.com/YellowsysOrg/YellowStorm/commit/d325b89599b4c78d216988cc019c3b74b23c6d75))
* streamline gRPC client initialization and improve code readability ([01363ad](https://github.com/YellowsysOrg/YellowStorm/commit/01363ad4d245181a2b3b5fd50b723758347e65db))
* updated mock grpc server ([04748f5](https://github.com/YellowsysOrg/YellowStorm/commit/04748f5bc3ca3650f552425661c7a97d9a1064ed))


### Highlights
* first stable version if the YellowStorm webapp backend features the basic modules and a solid foundation for the coming evolutions