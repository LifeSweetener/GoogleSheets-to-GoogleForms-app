const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const googleForms = require('@googleapis/forms');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Prints the names and majors of students in a sample spreadsheet:
 * @see https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 */
async function listMajors(auth) {
	// =====================
	// СЧИТАТЬ ГУГЛ-ТАБЛИЦУ:
	const sheets = google.sheets({version: 'v4', auth});
	const docID = process.argv[2];
	
	const res = (await sheets.spreadsheets.values.get({
		spreadsheetId: docID,									// ЭТО ID ГУГЛ-ТАБЛИЦЫ
		range: 'A:C',											// считываемые ячейки таблицы
		majorDimension: 'COLUMNS',								// направление считывания (считывать поочерёдно колонки, т.е. не построчно)
	})).data;
	
	const ques = [];
	const choices = [];
	const answers = [];
	
	res.values[0].forEach((elem, i) => {						// массив вопросов
		if (i != 0 && elem && elem != '' && !elem.includes('Тема ')) {
			elem = elem.replace('\n', '').replace('\\n', '');
			ques.push(elem);
		}
	});
	
	res.values[1].forEach((elem, i) => {						// массив всех вариантов ответов
		if (i != 0 && elem && elem != '')
			choices.push(elem);
	});
	
	res.values[2].forEach((elem, i) => {						// массив верных вариантов ответов
		if (i != 0 && elem && elem != '') {
			if (elem[elem.length - 1] == '\n')
				elem = elem.slice(0, elem.length - 1);
			answers.push(elem);
		}
	});
	
	// ================
	// РАБОТА С ФОРМОЙ:
	const authClient = await authenticate({						// данные для входа в гугл-формы (см. следом)
		keyfilePath: path.join(__dirname, 'credentials.json'),
		scopes: 'https://www.googleapis.com/auth/drive',
	});
	const forms = googleForms.forms({							// авторизоваться в гугл-формы
		version: 'v1',
		auth: authClient,
	});
	const newForm = {											// запрос (из REST API) для создания новой формы
		info: {
			title: 'Средства связи в системах управления автономными роботами(общее)',
		}
	};
	const form = await forms.forms.create({						// создание новой формы
		requestBody: newForm,
	});
	
	let update = {												// запрос (из REST API) для редактирования формы (её описания)
		requests: [
		  {
			updateFormInfo: {
			    info: {
					description: 'Тест',
					documentTitle: 'Средства связи в системах управления автономными роботами(общее)'
			    },
			    updateMask: 'description, documentTitle',
			},
		  },
		],
	};
	await forms.forms.batchUpdate({								// изменение описания (description) формы
		formId: form.data.formId,
		requestBody: update,
	});
	
	update = {													// запрос на изменение настройки "Тест" (isQuiz) формы
		requests: [
		    {
				updateSettings: {
					settings: {
						quizSettings: {
							isQuiz: true
						}
					},
					updateMask: 'quizSettings.isQuiz',
				},
			},
		],
	};
	await forms.forms.batchUpdate({								// изменение настройки "Тест" (isQuiz) формы
		formId: form.data.formId,
		requestBody: update,
	});
	
	for (let i = ques.length - 1; i >= 0; --i) {				// поочерёдное добавление вопросов в форму					
		try {
			const que = ques[i];
			const values = choices[i].split('\n');				// подготовить массив всех вариантов к добавлению в форму
			const options = [];
			values.forEach((value) => {
				if (value != '')
					options.push(
						{
							"value": value
						}
					);
			});
			
			let update;
			if (!answers[i].includes('\n') && answers[answers.length - 1] != '\n') {		// если это вопрос с одним верным вариантом...
				update = {
					requests: [
						{
						createItem: {
							item: {
								"itemId": `${i}`,
								"title": `${i+1}. ${que}`,
								"questionItem": {
									"question": {
									  "questionId": "25405d" + (i%10) + (i%9 + 1),
									  "required": false,			// необязательный
									  "grading": {
										"pointValue": 1,			// кол-во баллов
										"correctAnswers": {
										  "answers": [
											{
											  "value": answers[i]
											}
										  ]
										}
									  },
									  "choiceQuestion": {
										"type": "RADIO",
										"options": options,
										"shuffle": true				// перемешивать варианты
									  }
									}
								}
							},
							location: {
								index: 0,
							},
						},
						},
					],
				};
			} else {																		// если это вопрос с несколькими верными вариантами...
				answers[i] = answers[i].split('\n');				// подготовить массив нескольких верных ответов к добавлению в форму
				const correct = [];
				answers[i].forEach((answer) => {
					correct.push({"value": answer})
				});
				update = {
					requests: [
						{
						createItem: {
							item: {
								"itemId": `${i}`,
								"title": `${i+1}. ${que}`,
								"questionItem": {
									"question": {
									  "questionId": "25405d" + (i%10) + (i%9 + 1),
									  "required": false,			// необязательный
									  "grading": {
										"pointValue": 1,			// кол-во баллов
										"correctAnswers": {
										  "answers": correct
										}
									  },
									  "choiceQuestion": {
										"type": "CHECKBOX",
										"options": options,
										"shuffle": true				// перемешивать варианты
									  }
									}
								}
							},
							location: {
								index: 0,
							},
						},
						},
					],
				};
			}
			
			await forms.forms.batchUpdate({
				formId: form.data.formId,
				requestBody: update,
			});
		} catch (err) {
			console.log(err)
		}
	}
}

authorize().then(listMajors).catch(console.error);
