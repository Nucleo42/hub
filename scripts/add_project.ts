import { parseArgs } from "node:util";

const GITHUB_TOKEN = process.env.TOKEN_GITHUB;
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN não encontrado nas variáveis de ambiente!");
  process.exit(1);
}

interface RepositoryResponse {
  type: string;
  fullName: string;
}

const formatRepoName = {
  "Back-end": "api",
  "Front-end": "web",
  "Mobile (Android e iOS)": "mobile",
  "Mobile (Multiplataforma)": "mobile",
  "Design (apenas se usar GitHub Projects)": "design",
  "Monorepo (selecione apenas esta opção se for um único repositório para todo o projeto)":
    "monorepo",
};

const formatTeamName = {
  api: "BE",
  web: "FE",
  mobile: "MOBILE",
  design: "UX",
};

async function createRequest(endpoint: string, body: unknown) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const {
  values: {
    "project-name": projectName,
    "use-github-projects": useGithubProjects,
    repositories: reposJson,
    "github-username": githubUsername,
  },
} = parseArgs({
  args: Bun.argv,
  options: {
    "project-name": { type: "string" },
    "use-github-projects": { type: "string" },
    repositories: { type: "string" },
    "github-username": { type: "string" },
  },
  strict: true,
  allowPositionals: true,
});

if (!projectName || !useGithubProjects || !reposJson || !githubUsername) {
  console.error("Erro: Todos os argumentos são obrigatórios");
  process.exit(1);
}

const useGithubProjectsBool = useGithubProjects.toLowerCase() === "true";

let repositories: string[];
try {
  repositories = JSON.parse(reposJson);
} catch (error) {
  console.error("Erro ao fazer parse dos repositórios:", error);
  process.exit(1);
}

async function processNewProject() {
  try {
    console.log("Iniciando processamento do novo projeto...");
    console.log({
      projectName,
      useGithubProjects: useGithubProjectsBool,
      repositories,
      githubUsername,
    });

    if (repositories.length === 0) {
      console.error("Erro: Nenhum repositório foi especificado");
      process.exit(1);
    }

    if (!projectName || githubUsername === undefined) {
      return console.error(
        "Erro: Nome do projeto e usuário do GitHub são obrigatórios"
      );
    }

    const listOfRepoCreated: RepositoryResponse[] = [];

    for (const repo of repositories) {
      const responseRepo = await createRepository(projectName, repo);
      listOfRepoCreated.push(responseRepo);
    }

    const teamId = await createTeam(projectName, listOfRepoCreated);

    await inveteUserAndSetTeam(githubUsername, teamId);


    console.log("Projeto processado com sucesso!");

    process.exit(0);
  } catch (error) {
    console.error("Erro ao processar projeto:", error);
    process.exit(1);
  }
}

async function createRepository(projectName: string, repoType: string) {
  const name: string = formatRepoName[repoType as keyof typeof formatRepoName];

  console.log(`Criando repositório ${name} para ${projectName}...`);
  const repoName = `${projectName
    .toLowerCase()
    .replace(/\s+/g, "-")}-${name.toLowerCase()}`;

  const response = await createRequest(
    "https://api.github.com/orgs/Nucleo42/repos",
    {
      name: repoName,
      private: false,
      has_issues: true,
      has_projects: true,
      has_wiki: false,
      auto_init: true,
      description: `Repositório de ${name} do projeto ${projectName}`,
      license_template: "gpl-3.0",
    }
  );

  if (!response.ok) {
    throw new Error(
      `Erro ao criar repositório ${name}: ${response.statusText}`
    );
  }

  const responseBody = await response.json();

  console.log(`Repositório ${name} criado com sucesso!`);
  return {
    type: name,
    fullName: (responseBody.full_name as string) || "",
  };
}

async function createTeam(
  projectName: string,
  listOfRepository: RepositoryResponse[]
) {
  console.log(`Criando time para o projeto ${projectName}...`);
  const mainTeamResponse = await createRequest(
    "https://api.github.com/orgs/Nucleo42/teams",
    {
      name: projectName,
      description: `Time para o projeto ${projectName}`,
      privacy: "closed",
      notification_setting: "notifications_enabled",
    }
  );

  if (!mainTeamResponse.ok) {
    const error = await mainTeamResponse.json();
    console.error("Erro ao criar repositório:", error);
    throw new Error(
      `Erro ao criar time para o projeto ${projectName}: ${mainTeamResponse.statusText}`
    );
  }

  const mainTeamResponseBody = await mainTeamResponse.json();
  const teamId = mainTeamResponseBody.id;

  for (const repo of listOfRepository) {
    const activity = formatTeamName[repo.type as keyof typeof formatTeamName];
    await createRequest(
      "https://api.github.com/orgs/Nucleo42/teams",
      {
        name: `${activity} ${projectName}`,
        parent_team_id: teamId,
        repo_names: [repo.fullName],
        permission: "push",
        privacy: "closed",
      }
    );
  }

  console.log(`Times para o projeto ${projectName} criado com sucesso!`);
  return teamId;
  return;
}

async function inveteUserAndSetTeam(username: string, teamCreatedId: string[]) {
  console.log(`Convidando usuário ${username} para o time...`);

  const user = await fetch(`https://api.github.com/users/${username}`);

  if (!user.ok) {
    throw new Error(`Usuário ${username} não encontrado`);
  }
  const userJson = await user.json();
  const userId = userJson.id;

  const userResponse = await createRequest(
    `https://api.github.com/orgs/Nucleo42/invitations`,
    {
      invitee_id: userId,
      team_ids: [teamCreatedId],
      role: "direct_member",
    }
  );

  if (!userResponse.ok) {
    throw new Error(
      `Erro ao convidar usuário ${username}: ${userResponse.statusText}`
    );
  }

  console.log(`Usuário ${username} convidado com sucesso!`);
}

processNewProject().catch((error) => {
  console.error("Erro inesperado:", error);
  process.exit(1);
});
