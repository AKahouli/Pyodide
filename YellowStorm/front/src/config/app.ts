interface AppConfig {
    name: string,
    author: {
        name: string,
        url: string
    },
}
export const appConfig: AppConfig = {
    name: "YellowMind",
    author: {
        name: "YellowSys",
        url: "https://yellowsys.ai/",
    }
}